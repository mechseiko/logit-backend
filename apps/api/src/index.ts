import { config } from './config.js';
import { createLogger } from './logger.js';
import { createStore } from './db/index.js';
import { createStorage } from './services/storage/index.js';
import { buildServices } from './services/index.js';
import { createApp } from './app.js';
import { productionIssues, startupSummary } from './startupChecks.js';
import { runToolSelfTest } from './services/pdf/selftest.js';

async function main(): Promise<void> {
  const logger = createLogger(config);

  const issues = productionIssues(config);
  if (config.isProd && issues.length > 0) {
    logger.error({ issues }, 'refusing to start: production configuration is incomplete');
    for (const issue of issues) logger.error(`  - ${issue.key}: ${issue.message}`);
    process.exit(1);
  }

  const store = await createStore(config);
  const storage = createStorage(config);
  const services = await buildServices({ config, store, storage, logger });
  const tools = await runToolSelfTest(config);
  const app = createApp({ config, store, storage, logger, services });

  logger.info(startupSummary(config, { pipeline: tools }), 'LOGIT API starting');
  if (!tools.ghostscript || !tools.poppler) {
    logger.warn(
      { ghostscript: tools.ghostscript, poppler: tools.poppler },
      'system PDF tools missing: thumbnails/compression fall back (fine in dev, unhealthy in production)',
    );
  }

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'logit api listening');
  });

  services.queue.start();
  services.cleanup.start();

  const memoryTimer = setInterval(() => {
    const usage = process.memoryUsage();
    const payload = {
      rssMb: Math.round(usage.rss / 1_048_576),
      heapUsedMb: Math.round(usage.heapUsed / 1_048_576),
      externalMb: Math.round(usage.external / 1_048_576),
    };
    if (payload.rssMb > 400) logger.warn(payload, 'memory high against the 512 MB instance limit');
    else logger.debug(payload, 'memory');
  }, 60_000);
  memoryTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(memoryTimer);
    services.cleanup.stop();
    await services.queue.stop(20_000);
    server.close();
    await store.flush?.();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
