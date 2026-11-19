import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  DPO_EMAIL,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_NAME,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP,
} from '@logit/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'apps/api/.env'), override: true });

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const hasFirebase = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
const hasS3 = Boolean(process.env.S3_BUCKET?.trim());

export const config = {
  nodeEnv,
  isProd,
  version: process.env.APP_VERSION ?? '1.0.0',
  /** Explicit escape hatch for staging: allow mock providers in production. */
  port: int(process.env.PORT, 4000),
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? `http://localhost:${int(process.env.PORT, 4000)}`).replace(
    /\/$/,
    '',
  ),
  appUrl: process.env.APP_URL?.replace(/\/$/, '') ?? 'http://localhost:5173',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  dataDir: process.env.DATA_DIR ?? path.join(repoRoot, '.data'),
  logLevel: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),

  /**
   * How many proxies sit in front of the API. Render terminates TLS and forwards to us, so the
   * client address is the last X-Forwarded-For hop: `1`. With this unset (or `false`) every request
   * would look like it came from the proxy and the whole site would share one rate-limit bucket.
   */
  trustProxy: ((): number | false | string => {
    const raw = process.env.TRUST_PROXY;
    if (raw === undefined) return 1;
    if (raw === 'false' || raw === '0') return false;
    const hops = Number(raw);
    return Number.isFinite(hops) ? hops : raw;
  })(),
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    /** Authenticated API routes. */
    api: int(process.env.RATE_LIMIT_API_PER_MIN, isProd ? 120 : 600),
    /** Public routes: webhook, signed file transfers, dev sign-in, pricing. */
    public: int(process.env.RATE_LIMIT_PUBLIC_PER_MIN, isProd ? 300 : 3000),
  },

  authMode: (process.env.AUTH_MODE ?? (hasFirebase ? 'firebase' : 'dev')) as 'firebase' | 'dev',
  devAuthSecret: process.env.DEV_AUTH_SECRET ?? 'logit-local-dev',
  /**
   * In production this must be set explicitly (startupChecks refuses to boot without it).
   * Local development falls back to the documented dev account so `npm run dev` behaves as the
   * README describes without extra setup.
   */
  adminBootstrapEmail:
    process.env.ADMIN_BOOTSTRAP_EMAIL ?? (nodeEnv === 'production' ? undefined : 'admin@uselogit.cv'),
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,

  storeDriver: (process.env.STORE_DRIVER ?? (hasFirebase ? 'firestore' : 'memory')) as
    | 'firestore'
    | 'memory',

  storageDriver: (process.env.STORAGE_DRIVER ?? (hasS3 ? 's3' : 'local')) as 's3' | 'local',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
  },

  aiProvider: (process.env.AI_PROVIDER ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'mock')) as
    | 'gemini'
    | 'mock',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',

  paymentsProvider: (process.env.PAYMENTS_PROVIDER ??
    (process.env.PAYSTACK_SECRET_KEY ? 'paystack' : 'mock')) as 'paystack' | 'mock',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',

  supportWhatsapp: SUPPORT_WHATSAPP,
  supportEmail: SUPPORT_EMAIL,
  dpoContact: DPO_EMAIL,
  legalEntityName: LEGAL_ENTITY_NAME,
  legalEntityAddress: LEGAL_ENTITY_ADDRESS,

  retentionDays: int(process.env.RETENTION_DAYS, 14),
  entriesRetentionDays: int(process.env.ENTRIES_RETENTION_DAYS, 180),
  maxConcurrentJobs: Math.max(1, int(process.env.MAX_CONCURRENT_JOBS, 1)),
  queuePollMs: int(process.env.QUEUE_POLL_MS, 3000),
  cleanupIntervalMs: int(process.env.CLEANUP_INTERVAL_MS, 60 * 60 * 1000),

  pdfTools: {
    ghostscript: process.env.GHOSTSCRIPT_BIN ?? 'gs',
    pdftoppm: process.env.PDFTOPPM_BIN ?? 'pdftoppm',
    pdftotext: process.env.PDFTOTEXT_BIN ?? 'pdftotext',
    pdfinfo: process.env.PDFINFO_BIN ?? 'pdfinfo',
  },

  storageBudgetBytes: int(process.env.STORAGE_BUDGET_BYTES, 10 * 1024 * 1024 * 1024),
  /** Tests set this to false to avoid writing files during unit runs. */
  persistLocalStore: bool(process.env.PERSIST_LOCAL_STORE, true),
};

export type AppConfig = typeof config;
