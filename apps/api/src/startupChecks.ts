import type { AppConfig } from './config.js';

export interface StartupIssue {
  key: string;
  message: string;
}

/**
 * Production fail-closed checks. In development nothing is enforced; in production the API
 * refuses to start unless the real adapters and secrets are configured. There is no override.
 */
export function productionIssues(config: AppConfig): StartupIssue[] {
  if (!config.isProd) return [];
  const issues: StartupIssue[] = [];
  const add = (key: string, message: string) => issues.push({ key, message });

  if (config.authMode !== 'firebase') {
    add('AUTH_MODE', 'AUTH_MODE must be firebase in production (dev tokens are not accepted).');
  }
  if (config.storeDriver !== 'firestore') {
    add('STORE_DRIVER', 'STORE_DRIVER must be firestore in production (memory loses data on restart).');
  }
  if (config.storageDriver !== 's3') {
    add('STORAGE_DRIVER', 'STORAGE_DRIVER must be s3 in production (local disk is not durable).');
  }
  if (config.aiProvider !== 'gemini') {
    add('AI_PROVIDER', 'AI_PROVIDER must be gemini in production, not the mock writer.');
  }
  if (config.paymentsProvider !== 'paystack') {
    add('PAYMENTS_PROVIDER', 'PAYMENTS_PROVIDER must be paystack in production, not the mock checkout.');
  }

  if (!config.firebaseServiceAccountJson) {
    add('FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_JSON is required for Firebase Auth and Firestore.');
  }
  if (!config.s3.bucket || !config.s3.accessKeyId || !config.s3.secretAccessKey) {
    add('S3_*', 'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required.');
  }
  if (!config.geminiApiKey) add('GEMINI_API_KEY', 'GEMINI_API_KEY is required for AI_PROVIDER=gemini.');
  if (!config.paystackSecretKey) add('PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET_KEY is required for payments.');
  if (!config.paystackPublicKey) add('PAYSTACK_PUBLIC_KEY', 'PAYSTACK_PUBLIC_KEY is required for the web app.');
  if (!config.appUrl.startsWith('https://') || !config.apiPublicUrl.startsWith('https://')) {
    add('APP_URL', 'APP_URL and API_PUBLIC_URL must be https:// in production.');
  }
  if (config.devAuthSecret.length < 24 || config.devAuthSecret === 'change-me-in-production') {
    add('DEV_AUTH_SECRET', 'DEV_AUTH_SECRET must be a long random value (it signs file URLs).');
  }
  if (config.adminBootstrapEmail === 'admin@uselogit.cv') {
    add('ADMIN_BOOTSTRAP_EMAIL', 'Set ADMIN_BOOTSTRAP_EMAIL to the owner’s real Google email.');
  }
  if (config.allowedOrigins.some((origin) => origin.includes('localhost'))) {
    add('ALLOWED_ORIGINS', 'ALLOWED_ORIGINS still contains a localhost origin.');
  }
  if (config.retentionDays < 1 || config.retentionDays > 30) {
    add('RETENTION_DAYS', 'RETENTION_DAYS must be between 1 and 30.');
  }

  return issues;
}

/** Safe startup summary: never includes secret values. */
export function startupSummary(
  config: AppConfig,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: config.version,
    nodeEnv: config.nodeEnv,
    appUrl: config.appUrl,
    apiPublicUrl: config.apiPublicUrl,
    authMode: config.authMode,
    storeDriver: config.storeDriver,
    storageDriver: config.storageDriver,
    aiProvider: config.aiProvider,
    paymentsProvider: config.paymentsProvider,
    retentionDays: config.retentionDays,
    entriesRetentionDays: config.entriesRetentionDays,
    maxConcurrentJobs: config.maxConcurrentJobs,
    adminBootstrapEmail: config.adminBootstrapEmail,
    ...extra,
  };
}
