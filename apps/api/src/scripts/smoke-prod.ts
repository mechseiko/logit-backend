import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { createStore } from '../db/index.js';
import { createAiProvider } from '../services/ai/index.js';
import { PaystackProvider } from '../services/payments/paystack.js';
import { createStorage } from '../services/storage/index.js';
import { productionIssues } from '../startupChecks.js';

type Status = 'PASS' | 'FAIL' | 'SKIP';

interface Result {
  name: string;
  status: Status;
  detail: string;
}

const results: Result[] = [];

async function check(name: string, run: () => Promise<string>, skip?: string): Promise<void> {
  if (skip) {
    results.push({ name, status: 'SKIP', detail: skip });
    return;
  }
  try {
    const detail = await run();
    results.push({ name, status: 'PASS', detail });
  } catch (error) {
    results.push({ name, status: 'FAIL', detail: (error as Error).message.slice(0, 160) });
  }
}

function table(): string {
  const width = Math.max(...results.map((result) => result.name.length), 4);
  const lines = [
    `${'CHECK'.padEnd(width)}  STATUS  DETAIL`,
    `${'-'.repeat(width)}  ------  ------`,
    ...results.map(
      (result) => `${result.name.padEnd(width)}  ${result.status.padEnd(6)}  ${result.detail}`,
    ),
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const issues = productionIssues(config);

  await check('Environment', async () => {
    if (!config.isProd) return 'development mode (checks still run against configured adapters)';
    if (issues.length > 0) {
      throw new Error(`${issues.length} production issue(s): ${issues.map((i) => i.key).join(', ')}`);
    }
    return 'production configuration complete';
  });

  await check(
    'Firebase Admin + Firestore',
    async () => {
      const store = await createStore(config);
      const path = `_smoke/${Date.now().toString(36)}`;
      await store.set(path, { ok: true, at: new Date().toISOString() });
      const read = await store.get<{ ok: boolean }>(path);
      if (!read?.ok) throw new Error('read back failed');
      await store.delete(path);
      return `read/write/delete ok (${config.storeDriver})`;
    },
    config.storeDriver !== 'firestore' ? 'STORE_DRIVER is not firestore' : undefined,
  );

  await check('Storage signed read/write/delete', async () => {
    const storage = createStorage(config);
    const key = `_smoke/${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.txt`;
    const body = Buffer.from('logit smoke test');
    await storage.put(key, body, 'text/plain');
    const read = await storage.get(key);
    if (!read.equals(body)) throw new Error('stored bytes differ');
    const url = await storage.signedGetUrl(key, 'smoke.txt');
    if (!url.includes('token=') && !url.includes('X-Amz-Signature')) {
      throw new Error('signed URL was not produced');
    }
    await storage.delete(key);
    if (await storage.exists(key)) throw new Error('object still exists after delete');
    return `put/get/sign/delete ok (${config.storageDriver})`;
  });

  await check(
    'Gemini model call',
    async () => {
      const ai = createAiProvider(config);
      const text = await ai.shorten({
        text: 'I terminated the network cables and tested every patch cord before labelling them.',
        maxChars: 60,
      });
      if (!text) throw new Error('empty response');
      return `${config.geminiModel} replied (${text.length} chars)`;
    },
    config.aiProvider === 'mock' ? 'AI_PROVIDER=mock' : undefined,
  );

  await check(
    'Paystack initialize (₦100 test reference)',
    async () => {
      const provider = new PaystackProvider(config.paystackSecretKey);
      const reference = `LGT_SMOKE_${Date.now().toString(36)}`;
      const result = await provider.initialize({
        reference,
        amountKobo: 10_000,
        email: config.supportEmail,
        callbackUrl: `${config.appUrl}/app/credits`,
        metadata: { smoke: 'true' },
      });
      if (!result.authorizationUrl.startsWith('https://')) {
        throw new Error('no checkout URL returned');
      }
      return `checkout created for ${reference}`;
    },
    config.paymentsProvider === 'mock' || !config.paystackSecretKey
      ? 'PAYMENTS_PROVIDER=mock or missing secret key'
      : undefined,
  );

  console.log(`\nLOGIT production smoke test — ${config.nodeEnv} — ${new Date().toISOString()}\n`);
  console.log(table());
  const failed = results.filter((result) => result.status === 'FAIL');
  console.log(
    `\n${results.filter((r) => r.status === 'PASS').length} passed, ` +
      `${results.filter((r) => r.status === 'SKIP').length} skipped, ${failed.length} failed.`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('Smoke test crashed:', (error as Error).message);
  process.exit(1);
});
