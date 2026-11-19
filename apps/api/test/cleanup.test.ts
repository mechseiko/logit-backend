import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job, WeekRecord } from '@logit/shared';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;

const makeJob = (id: string, overrides: Partial<Job> = {}): Job => {
  const now = new Date().toISOString();
  return {
    id,
    uid: 'user_cleanup',
    status: 'generated',
    title: 'Cleanup job',
    programme: 'SIWES',
    schoolId: '',
    input: { kind: 'pdf', files: [] },
    mode: 'copysheet',
    usage: { previewsUsed: 0, chatMessages: 0, aiCalls: 0 },
    outputs: [],
    queue: { state: 'idle', attempts: 0 },
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
};

const makeWeek = (weekNumber: number): WeekRecord => ({
  weekNumber,
  startDate: '2026-02-02',
  endDate: '2026-02-06',
  workingDates: ['2026-02-02'],
  days: [{ date: '2026-02-02', dayName: 'Monday', entry: 'Entry', basedOn: ['T1'] }],
  status: 'done',
  regenCount: 0,
  flags: [],
});

beforeAll(async () => {
  ctx = await createTestContext({ storageBudgetBytes: 100_000 });
});
afterAll(async () => {
  await ctx.close();
});

describe('retention cleanup', () => {
  it('deletes expired jobs and their stored files', async () => {
    const job = makeJob('job_expired', {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await ctx.store.set(`jobs/${job.id}`, job);
    await ctx.storage.put(`normalized/${job.uid}/${job.id}/original.pdf`, Buffer.from('x'), 'application/pdf');
    await ctx.storage.put(`outputs/${job.uid}/${job.id}/v1.pdf`, Buffer.from('y'), 'application/pdf');

    const result = await ctx.services.cleanup.run(new Date());
    expect(result.jobsDeleted).toBeGreaterThanOrEqual(1);
    expect(await ctx.store.get(`jobs/${job.id}`)).toBeNull();
    expect(await ctx.storage.exists(`normalized/${job.uid}/${job.id}/original.pdf`)).toBe(false);
    expect(await ctx.storage.exists(`outputs/${job.uid}/${job.id}/v1.pdf`)).toBe(false);
  });

  it('deletes entry text after the entries retention window but keeps the job', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const job = makeJob('job_old_entries', { lastActivityAt: old, updatedAt: old });
    await ctx.store.set(`jobs/${job.id}`, job);
    await ctx.store.set(`jobs/${job.id}/weeks/1`, makeWeek(1));
    await ctx.store.set(`jobs/${job.id}/weeks/2`, makeWeek(2));

    const result = await ctx.services.cleanup.run(new Date());
    expect(result.weeksDeleted).toBeGreaterThanOrEqual(2);
    expect(await ctx.store.get(`jobs/${job.id}/weeks/1`)).toBeNull();
    expect(await ctx.store.get(`jobs/${job.id}`)).not.toBeNull();
  });

  it('never deletes a logbook that is still being processed or generated', async () => {
    const job = makeJob('job_in_flight', {
      status: 'generating',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      queue: { state: 'running', kind: 'generate', attempts: 0 },
    });
    await ctx.store.set(`jobs/${job.id}`, job);
    const result = await ctx.services.cleanup.run(new Date());
    expect(result.jobsDeleted).toBe(0);
    expect(await ctx.store.get(`jobs/${job.id}`)).not.toBeNull();
  });

  it('records the storage guard ratio', async () => {
    await ctx.storage.put('misc/filler.bin', Buffer.alloc(80_000), 'application/octet-stream');
    await ctx.services.cleanup.run(new Date());
    const flags = await ctx.store.get<{ warning: boolean; ratio: number }>('config/storage');
    expect(flags?.warning).toBe(true);
    expect(flags?.ratio).toBeGreaterThanOrEqual(0.7);
  });
});
