import { describe, expect, it } from 'vitest';
import { config, type AppConfig } from '../src/config.js';
import { productionIssues, startupSummary } from '../src/startupChecks.js';

function productionConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...config,
    isProd: true,
    nodeEnv: 'production',
    authMode: 'firebase',
    storeDriver: 'firestore',
    storageDriver: 's3',
    aiProvider: 'gemini',
    paymentsProvider: 'paystack',
    firebaseServiceAccountJson: '{"project_id":"x"}',
    geminiApiKey: 'key',
    paystackSecretKey: 'sk',
    paystackPublicKey: 'pk',
    appUrl: 'https://uselogit.cv',
    apiPublicUrl: 'https://api.uselogit.cv',
    allowedOrigins: ['https://uselogit.cv'],
    devAuthSecret: 'a-very-long-random-secret-value',
    adminBootstrapEmail: 'owner@example.org',
    s3: {
      ...config.s3,
      bucket: 'logit',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    },
    ...overrides,
  };
}

describe('production fail-closed checks', () => {
  it('accepts a fully configured production environment', () => {
    expect(productionIssues(productionConfig())).toEqual([]);
  });

  it('refuses dev auth, mocks and local storage', () => {
    const issues = productionIssues(
      productionConfig({
        authMode: 'dev',
        aiProvider: 'mock',
        paymentsProvider: 'mock',
        storageDriver: 'local',
        storeDriver: 'memory',
      }),
    );
    const keys = issues.map((issue) => issue.key);
    expect(keys).toEqual(
      expect.arrayContaining(['AUTH_MODE', 'AI_PROVIDER', 'PAYMENTS_PROVIDER', 'STORAGE_DRIVER', 'STORE_DRIVER']),
    );
  });

  it('flags missing secrets, non-https URLs, localhost origins and a default admin email', () => {
    const issues = productionIssues(
      productionConfig({
        firebaseServiceAccountJson: undefined,
        geminiApiKey: '',
        paystackSecretKey: '',
        appUrl: 'http://localhost:5173',
        allowedOrigins: ['http://localhost:5173'],
        adminBootstrapEmail: 'admin@uselogit.cv',
        devAuthSecret: 'short',
      }),
    );
    const keys = issues.map((issue) => issue.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'FIREBASE_SERVICE_ACCOUNT_JSON',
        'GEMINI_API_KEY',
        'PAYSTACK_SECRET_KEY',
        'APP_URL',
        'ALLOWED_ORIGINS',
        'ADMIN_BOOTSTRAP_EMAIL',
        'DEV_AUTH_SECRET',
      ]),
    );
  });

  it('enforces nothing in development and never leaks secrets in the summary', () => {
    expect(productionIssues({ ...config, isProd: false })).toEqual([]);
    const summary = JSON.stringify(startupSummary(productionConfig()));
    expect(summary).not.toContain('a-very-long-random-secret-value');
    expect(summary).not.toContain('secret');
    expect(summary).toContain('"version"');
  });
});
