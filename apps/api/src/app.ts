import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import type { Store } from './db/index.js';
import type { Logger } from './logger.js';
import type { Services } from './services/index.js';
import type { StorageAdapter } from './services/storage/index.js';
import { createAdminRouter } from './http/routes/admin.js';
import { createCreditsRouter } from './http/routes/credits.js';
import { createJobsRouter } from './http/routes/jobs.js';
import { createMeRouter } from './http/routes/me.js';
import { createPublicRouter } from './http/routes/public.js';
import { createSchoolsRouter } from './http/routes/schools.js';
import {
  authenticate,
  errorHandler,
  notFoundHandler,
  requestId,
  requestLogger,
  requireAdmin,
} from './http/middleware.js';
import './http/context.js';

export interface AppOptions {
  config: AppConfig;
  store: Store;
  storage: StorageAdapter;
  logger: Logger;
  services: Services;
}

export function createApp(options: AppOptions): Express {
  const { config, store, storage, logger, services } = options;
  const app = express();
  app.disable('x-powered-by');
  // Behind Render's proxy: req.ip must be the student's address, not the proxy's, otherwise every
  // user shares one rate-limit bucket. Configurable for a different topology (TRUST_PROXY).
  app.set('trust proxy', config.trustProxy);
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        if (!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );
  app.use(
    requestLogger(logger),
  );

  // Public + raw-body routes must be registered before the JSON parser. They get their own,
  // wider limiter: the webhook, signed file transfers and dev sign-in used to be unthrottled.
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.public,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
    }),
  );
  app.use(createPublicRouter({ config, store, storage, services }));

  app.use('/api', express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.api,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
    }),
  );
  app.use('/api', authenticate(store, config));

  app.use('/api/me', createMeRouter(services, store, config));
  app.use('/api', createSchoolsRouter(store));
  app.use('/api', createJobsRouter(services, config));
  app.use('/api', createCreditsRouter(services, config));
  app.use('/api/admin', requireAdmin(store, config), createAdminRouter(services, store, storage, config));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
