import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '@logit/shared';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;

const makeJob = (id: string, overrides: Partial<Job> = {}): Job => {
  const now = new Date().toISOString();
  return {
    id,
    uid: 'queue_user',
    status: 'processing',
    title: 'Queue job',
    programme: 'SIWES',
    schoolId: '',
    input: { kind: 'pdf', files: [] },
    mode: null,
    usage: { previewsUsed: 0, chatMessages: 0, aiCalls: 0 },
    outputs: [],
    queue: {
      state: 'running',
      kind: 'ingest',
      attempts: 0,
      lockedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
};

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('queue recovery', () => {
  it('re-queues a job that was running when the process died', async () => {
    const job = makeJob('job_stuck');
    await ctx.store.set(`jobs/${job.id}`, job);
    const recovered = await ctx.services.queue.recover();
    expect(recovered).toBe(1);
    const next = await ctx.store.get<Job>(`jobs/${job.id}`);
    expect(next?.status).toBe('queued');
    expect(next?.queue.state).toBe('queued');
    expect(next?.queue.attempts).toBe(1);
    expect(next?.queue.lockedAt).toBeUndefined();
  });

  it('fails a job that has already been recovered three times', async () => {
    const job = makeJob('job_hopeless', { queue: { ...makeJob('x').queue, attempts: 4 } });
    await ctx.store.set(`jobs/${job.id}`, job);
    await ctx.services.queue.recover();
    const next = await ctx.store.get<Job>(`jobs/${job.id}`);
    expect(next?.status).toBe('failed');
    expect(next?.error?.retryable).toBe(true);
  });

  it('does not touch healthy running jobs', async () => {
    const job = makeJob('job_healthy', {
      queue: {
        state: 'running',
        kind: 'ingest',
        attempts: 0,
        lockedAt: new Date().toISOString(),
      },
    });
    await ctx.store.set(`jobs/${job.id}`, job);
    await ctx.services.queue.recover();
    const next = await ctx.store.get<Job>(`jobs/${job.id}`);
    expect(next?.status).toBe('processing');
  });
});
