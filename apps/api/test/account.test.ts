import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { computePlan, type AiProvider, type Job } from '@logit/shared';
import { createTestContext, onboard, processQueue, signIn, uploadJob, waitForJob, type SignedIn, type TestContext } from './helpers.js';
import { makeLogbookPdf } from './fixtures.js';
import { GenerationService } from '../src/services/generation.js';

const QUICK_INTAKE = {
  company: 'Zenith Bank',
  unit: 'IT Support',
  startDate: '2026-02-02',
  endDate: '2026-02-06',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  extraDaysOff: [],
  tasks: [
    { id: 'T1', text: 'Cable termination' },
    { id: 'T2', text: 'Printer setup' },
    { id: 'T3', text: 'Fault documentation' },
  ],
  tools: ['crimping tool'],
  skills: ['fault finding'],
  detail: 'standard' as const,
};

describe('account deletion', () => {
  let ctx: TestContext;
  let session: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'delete-me@test.local', 'Delete Me');
    await onboard(ctx, session);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('removes the profile, jobs, ledger and stored files', async () => {
    const pdf = await makeLogbookPdf({ pages: 3 });
    const jobId = await uploadJob(ctx, session.auth, 'pdf', [
      { name: 'delete.pdf', type: 'application/pdf', bytes: pdf },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, jobId, (entry) => entry.status === 'needs_layout_choice');
    const normalizedKey = job.normalized!.key;
    const thumbKey = `thumbs/${session.uid}/${jobId}/p1.png`;
    expect(await ctx.storage.exists(normalizedKey)).toBe(true);

    await ctx.store.merge(`users/${session.uid}`, { balance: 250 });
    // A real ledger row, so the account-deletion purge is actually exercised.
    await ctx.services.credits.purchase(session.uid, 'LGT_purge_test', 100);
    await request(ctx.app).post(`/api/jobs/${jobId}/select-template`).set(session.auth).send({ templateId: null });

    const response = await request(ctx.app).delete('/api/me').set(session.auth);
    expect(response.status).toBe(200);

    expect(await ctx.store.get(`users/${session.uid}`)).toBeNull();
    expect(await ctx.store.get(`jobs/${jobId}`)).toBeNull();
    expect(await ctx.storage.exists(normalizedKey)).toBe(false);
    expect(await ctx.storage.exists(thumbKey)).toBe(false);
    const ledger = await ctx.store.query(`creditLedger`, { where: [['uid', '==', session.uid]] });
    expect(ledger).toHaveLength(0);
    const rate = await ctx.store.query('rate', { where: [['uid', '==', session.uid]] });
    expect(rate).toHaveLength(0);
  });
});

describe('admin ledger CSV', () => {
  let ctx: TestContext;
  let admin: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    admin = await signIn(ctx, 'admin@logit.test', 'Admin');
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exports every credit movement as CSV', async () => {
    const user = await signIn(ctx, 'csv@test.local', 'CSV User');
    await request(ctx.app)
      .post(`/api/admin/users/${user.uid}/adjust`)
      .set(admin.auth)
      .send({ amount: 25, reason: 'Ledger CSV test' });

    const response = await request(ctx.app).get('/api/admin/ledger.csv').set(admin.auth);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.split('\n')[0]).toBe(
      'id,uid,type,amount,balanceAfter,reservedAfter,ref,note,createdAt',
    );
    expect(response.text).toContain(user.uid);
    expect(response.text).toContain('adjustment');
  });
});

describe('generation failure', () => {
  let ctx: TestContext;
  let session: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'ai-fail@test.local', 'AI Fail');
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('releases reserved credits and marks the job retryable', async () => {
    await ctx.store.merge(`users/${session.uid}`, { balance: 500 });
    const plan = computePlan({
      startDate: '2026-02-02',
      endDate: '2026-02-06',
      workingDays: [1, 2, 3, 4, 5],
    });
    const now = new Date().toISOString();
    const jobId = 'job_ai_failure';
    const job: Job = {
      id: jobId,
      uid: session.uid,
      status: 'generating',
      title: 'AI failure',
      programme: 'SIWES',
      schoolId: 'unilag',
      input: { kind: 'pdf', files: [] },
      mode: 'copysheet',
      intake: QUICK_INTAKE,
      plan,
      usage: { previewsUsed: 0, chatMessages: 0, aiCalls: 0 },
      outputs: [],
      queue: { state: 'running', kind: 'generate', attempts: 0 },
      generationAttempt: 1,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    await ctx.store.set(`jobs/${jobId}`, job);
    await ctx.services.credits.reserve(session.uid, jobId, plan.cost, 1);

    const failing: AiProvider = {
      name: 'failing',
      async generateWeek() {
        throw new Error('provider down');
      },
      async shorten({ text }) {
        return text;
      },
      async chat() {
        return '';
      },
    };
    const service = new GenerationService(ctx.store, failing, ctx.config, ctx.services.templates);
    await service.run(jobId);

    const fresh = await ctx.store.get<Job>(`jobs/${jobId}`);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.error?.code).toBe('AI_UNAVAILABLE');
    expect(fresh?.error?.retryable).toBe(true);

    const money = await ctx.services.credits.balance(session.uid);
    expect(money).toEqual({ balance: 500, reserved: 0 });
    const ledger = await ctx.store.query<{ type: string; amount: number }>('creditLedger', {
      where: [['uid', '==', session.uid]],
    });
    expect(ledger.some((entry) => entry.type === 'release' && entry.amount === plan.cost)).toBe(true);
  }, 20_000);

  it('retries as a new attempt, reserves again and charges exactly once', async () => {
    // Regression: the student-facing retry used to reuse attempt 1, so commit threw
    // "Reserved credits would go negative" after the AI had already rewritten every week.
    const plan = computePlan({
      startDate: '2026-02-02',
      endDate: '2026-02-06',
      workingDays: [1, 2, 3, 4, 5],
    });
    const jobId = 'job_ai_retry';
    const now = new Date().toISOString();
    await ctx.store.set(`jobs/${jobId}`, {
      id: jobId,
      uid: session.uid,
      status: 'failed',
      title: 'AI retry',
      programme: 'SIWES',
      schoolId: 'unilag',
      input: { kind: 'pdf', files: [] },
      normalized: {
        key: `normalized/${session.uid}/${jobId}/original.pdf`,
        bytes: 1024,
        pages: 1,
        pageWidthPt: 595,
        pageHeightPt: 842,
      },
      mode: 'copysheet',
      intake: QUICK_INTAKE,
      plan,
      usage: { previewsUsed: 0, chatMessages: 0, aiCalls: 0 },
      outputs: [],
      queue: { state: 'failed', kind: 'generate', attempts: 1 },
      generationAttempt: 1,
      error: { code: 'AI_UNAVAILABLE', message: 'provider down', retryable: true },
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    } satisfies Job);

    const retried = await ctx.services.jobs.retry(session.uid, jobId);
    expect(retried.status).toBe('ready_to_generate');
    expect(retried.generationAttempt).toBe(2);

    await ctx.services.generation.start(session.uid, jobId, false);
    expect((await ctx.services.credits.balance(session.uid)).reserved).toBe(plan.cost);
    await ctx.services.generation.run(jobId);

    const done = await ctx.store.get<Job>(`jobs/${jobId}`);
    expect(done?.status).toBe('generated');
    // Reserved on start, committed on success: charged exactly once at the plan price.
    expect(await ctx.services.credits.balance(session.uid)).toEqual({
      balance: 500 - plan.cost,
      reserved: 0,
    });
  }, 20_000);
});
