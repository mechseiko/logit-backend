import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config as baseConfig, type AppConfig } from '../src/config.js';
import { MemoryStore } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { buildServices, type Services } from '../src/services/index.js';
import { seedGenericTemplate } from './genericTemplate.js';
import { LocalStorageAdapter } from '../src/services/storage/local.js';
import type { Job } from '@logit/shared';

export interface TestContext {
  app: Express;
  store: MemoryStore;
  storage: LocalStorageAdapter;
  services: Services;
  config: AppConfig;
  dir: string;
  token(email: string, name?: string): string;
  close(): Promise<void>;
}

export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'logit-test-'));
  const config: AppConfig = {
    ...baseConfig,
    nodeEnv: 'test',
    isProd: false,
    authMode: 'dev',
    storeDriver: 'memory',
    storageDriver: 'local',
    persistLocalStore: false,
    dataDir: dir,
    devAuthSecret: 'test-secret',
    apiPublicUrl: 'http://localhost:4000',
    appUrl: 'http://localhost:5173',
    aiProvider: 'mock',
    paymentsProvider: 'mock',
    adminBootstrapEmail: 'admin@logit.test',
    logLevel: 'silent',
    queuePollMs: 60_000,
    cleanupIntervalMs: 60_000_000,
    ...overrides,
  };
  const store = new MemoryStore();
  const storage = new LocalStorageAdapter({
    rootDir: path.join(dir, 'storage'),
    publicUrl: config.apiPublicUrl,
    secret: config.devAuthSecret,
  });
  const logger = createLogger(config);
  const services = await buildServices({ config, store, storage, logger });
  await seedGenericTemplate(store);
  const app = createApp({ config, store, storage, logger, services });

  return {
    app,
    store,
    storage,
    services,
    config,
    dir,
    token(email: string, name?: string) {
      return `dev.${Buffer.from(JSON.stringify({ email, name })).toString('base64url')}`;
    },
    async close() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface SignedIn {
  token: string;
  auth: { authorization: string };
  uid: string;
  user: Record<string, unknown>;
}

export async function signIn(
  ctx: TestContext,
  email: string,
  name = 'Test Student',
): Promise<SignedIn> {
  const token = ctx.token(email, name);
  const auth = { authorization: `Bearer ${token}` };
  const response = await request(ctx.app).post('/api/me/bootstrap').set(auth).send({});
  if (response.status !== 200) throw new Error(`bootstrap failed: ${response.text}`);
  return { token, auth, uid: response.body.user.uid, user: response.body.user };
}

export async function onboard(ctx: TestContext, session: SignedIn): Promise<void> {
  const schools = await request(ctx.app).get('/api/schools?q=UNILAG').set(session.auth);
  const schoolId = schools.body.schools[0]?.id;
  const response = await request(ctx.app)
    .patch('/api/me/onboarding')
    .set(session.auth)
    .send({
      schoolId,
      department: 'Computer Science',
      programme: 'SIWES',
      level: '400',
      consent: { version: '2026-02-01', over18: true },
    });
  if (response.status !== 200) throw new Error(`onboarding failed: ${response.text}`);
}

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Buffer;
}

/** Runs presign -> signed PUT -> submit, exactly like the browser does. */
export async function uploadJob(
  ctx: TestContext,
  auth: { authorization: string },
  kind: 'pdf' | 'images',
  files: UploadedFile[],
): Promise<string> {
  const presign = await request(ctx.app)
    .post('/api/uploads/presign')
    .set(auth)
    .send({
      kind,
      files: files.map((file) => ({ name: file.name, type: file.type, size: file.bytes.byteLength })),
    });
  if (presign.status !== 200) throw new Error(`presign failed: ${presign.text}`);

  const { jobId, uploads } = presign.body as {
    jobId: string;
    uploads: { key: string; url: string; headers: Record<string, string> }[];
  };

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const upload = uploads[index]!;
    const url = new URL(upload.url);
    const response = await request(ctx.app)
      .put(`${url.pathname}${url.search}`)
      .set('content-type', file.type)
      .send(file.bytes);
    if (response.status !== 200) throw new Error(`upload failed: ${response.text}`);
  }

  const submit = await request(ctx.app)
    .post(`/api/jobs/${jobId}/submit`)
    .set(auth)
    .send({ orderedKeys: uploads.map((upload) => upload.key) });
  if (submit.status !== 200) throw new Error(`submit failed: ${submit.text}`);
  return jobId;
}

export async function processQueue(ctx: TestContext): Promise<void> {
  await ctx.services.queue.tick();
}

export async function readJob(ctx: TestContext, jobId: string): Promise<Job> {
  const job = await ctx.store.get<Job>(`jobs/${jobId}`);
  if (!job) throw new Error('job missing');
  return job;
}

export async function waitForJob(
  ctx: TestContext,
  jobId: string,
  predicate: (job: Job) => boolean,
  timeoutMs = 20_000,
): Promise<Job> {
  const started = Date.now();
  for (;;) {
    const job = await readJob(ctx, jobId);
    if (predicate(job)) return job;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for job (${job.status})`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const QUICK_INTAKE = {
  company: 'Zenith Bank',
  unit: 'IT Support',
  startDate: '2026-02-02',
  endDate: '2026-02-20',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  extraDaysOff: [],
  tasks: [
    { text: 'Terminating and testing network cables' },
    { text: 'Installing and configuring office printers' },
    { text: 'Documenting faults reported by staff' },
  ],
  tools: ['crimping tool', 'cable tester'],
  skills: ['fault finding'],
  detail: 'standard',
};
