import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  QUICK_INTAKE,
  createTestContext,
  onboard,
  processQueue,
  signIn,
  uploadJob,
  waitForJob,
  type SignedIn,
  type TestContext,
} from './helpers.js';
import { makeLogbookPdf } from './fixtures.js';

describe('copy-sheet path, preview limits and regeneration pricing', () => {
  let ctx: TestContext;
  let session: SignedIn;
  let jobId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'copysheet@test.local', 'Copy Sheet Student');
    await onboard(ctx, session);

    const pdf = await makeLogbookPdf({ pages: 3 });
    jobId = await uploadJob(ctx, session.auth, 'pdf', [
      { name: 'unsupported.pdf', type: 'application/pdf', bytes: pdf },
    ]);
    await processQueue(ctx);
    await waitForJob(ctx, jobId, (entry) => entry.status === 'needs_layout_choice');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('continues with a copy sheet when the layout is not supported', async () => {
    const none = await request(ctx.app)
      .post(`/api/jobs/${jobId}/select-template`)
      .set(session.auth)
      .send({ templateId: null });
    expect(none.status).toBe(200);
    expect(none.body.job.status).toBe('awaiting_template');

    const copy = await request(ctx.app)
      .post(`/api/jobs/${jobId}/mode`)
      .set(session.auth)
      .send({ mode: 'copysheet' });
    expect(copy.status).toBe(200);
    expect(copy.body.job.status).toBe('needs_intake');

    const intake = await request(ctx.app)
      .put(`/api/jobs/${jobId}/intake`)
      .set(session.auth)
      .send({
        intake: { ...QUICK_INTAKE, linesPerDay: 6, charsPerLine: 65 },
      });
    expect(intake.status).toBe(200);
    expect(intake.body.weeks).toBe(3);
  });

  it('allows one preview per job and blocks the second', async () => {
    const first = await request(ctx.app).post(`/api/jobs/${jobId}/preview`).set(session.auth);
    expect(first.status).toBe(200);
    const second = await request(ctx.app).post(`/api/jobs/${jobId}/preview`).set(session.auth);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/preview/i);
  });

  it('exports a copy sheet and charges for the third regeneration', async () => {
    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(session.auth)
      .send({ packId: 'pack_2000' });
    await ctx.store.merge(`payments/${init.body.reference}`, { mockPaid: true });
    const paid = await request(ctx.app)
      .get(`/api/payments/verify/${init.body.reference}`)
      .set(session.auth);
    expect(paid.body.status).toBe('success');

    await request(ctx.app).post(`/api/jobs/${jobId}/generate`).set(session.auth);
    await processQueue(ctx);
    await waitForJob(ctx, jobId, (entry) => entry.status === 'generated');

    const first = await request(ctx.app)
      .post(`/api/jobs/${jobId}/weeks/1/regenerate`)
      .set(session.auth);
    expect(first.body.charged).toBe(0);
    const second = await request(ctx.app)
      .post(`/api/jobs/${jobId}/weeks/1/regenerate`)
      .set(session.auth);
    expect(second.body.charged).toBe(0);
    const third = await request(ctx.app)
      .post(`/api/jobs/${jobId}/weeks/1/regenerate`)
      .set(session.auth);
    expect(third.body.charged).toBe(5);
    expect(third.body.week.regenCount).toBe(3);
    expect(third.body.balance).toBe(105); // 210 top-up − 100 generation − 5 regeneration

    const exportResult = await request(ctx.app).post(`/api/jobs/${jobId}/export`).set(session.auth);
    expect(exportResult.status).toBe(200);
    expect(exportResult.body.kind).toBe('copysheet');

    const download = await request(ctx.app).get(`/api/jobs/${jobId}/download`).set(session.auth);
    expect(download.status).toBe(200);
  });
});
