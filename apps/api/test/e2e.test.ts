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

describe('end-to-end happy path (all mocks)', () => {
  let ctx: TestContext;
  let session: SignedIn;
  let jobId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'student@test.local', 'Ada Student');
    await onboard(ctx, session);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('bootstraps a user with a referral code and tokens', async () => {
    expect(session.user.referralCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(session.user.balance).toBe(0);
    const me = await request(ctx.app).get('/api/me').set(session.auth);
    expect(me.status).toBe(200);
    expect(me.body.user.onboardingDone).toBe(true);
    expect(me.body.user.consent.version).toBe('2026-02-01');
  });

  it('rejects a fake PDF with a clear error and no credit impact', async () => {
    const uploadId = await uploadJob(ctx, session.auth, 'pdf', [
      { name: 'fake.pdf', type: 'application/pdf', bytes: Buffer.from('this is not a pdf') },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, uploadId, (entry) => entry.status === 'failed');
    expect(job.error?.code).toBe('UNSUPPORTED_FILE');
    const credits = await request(ctx.app).get('/api/credits').set(session.auth);
    expect(credits.body.balance).toBe(0);
    expect(credits.body.reserved).toBe(0);
  });

  it('uploads a PDF and ingests it straight to the questions', async () => {
    const pdf = await makeLogbookPdf({ pages: 4 });
    jobId = await uploadJob(ctx, session.auth, 'pdf', [
      { name: 'my-logbook.pdf', type: 'application/pdf', bytes: pdf },
    ]);
    await processQueue(ctx);
    const job = await waitForJob(ctx, jobId, (entry) => entry.status === 'needs_intake');
    expect(job.normalized?.pages).toBe(4);
    expect(job.analysis?.looksLikeLogbook).toBe(true);
    expect(job.analysis?.hasEmbeddedText).toBe(true);
    expect(job.profileId).toBeTruthy();

    const thumb = await request(ctx.app).get(`/api/jobs/${jobId}/thumb/1`).set(session.auth);
    expect(thumb.status).toBe(200);
    expect(thumb.body.url).toContain('/api/files');

    const detail = await request(ctx.app).get(`/api/jobs/${jobId}`).set(session.auth);
    expect(detail.body.profile.daysPerWeek).toBeGreaterThan(0);
  });

  it('requires credits before generation, then generates and exports', async () => {
    const intake = await request(ctx.app)
      .put(`/api/jobs/${jobId}/intake`)
      .set(session.auth)
      .send({ intake: QUICK_INTAKE, studentDetails: { fullName: 'Ada Student', matricNo: 'CSC/2021/1234' } });
    expect(intake.status).toBe(200);
    expect(intake.body.weeks).toBe(3);
    expect(intake.body.cost).toBe(100);

    const tooEarly = await request(ctx.app).post(`/api/jobs/${jobId}/generate`).set(session.auth);
    expect(tooEarly.status).toBe(402);
    expect(tooEarly.body.error.code).toBe('INSUFFICIENT_CREDITS');

    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(session.auth)
      .send({ packId: 'pack_1000' });
    expect(init.status).toBe(200);
    const reference = init.body.reference as string;
    await ctx.store.merge(`payments/${reference}`, { mockPaid: true });
    const paid = await request(ctx.app)
      .get(`/api/payments/verify/${reference}`)
      .set(session.auth);
    expect(paid.body.status).toBe('success');
    expect(paid.body.credits).toBe(100);

    const preview = await request(ctx.app).post(`/api/jobs/${jobId}/preview`).set(session.auth);
    expect(preview.status).toBe(200);
    expect(preview.body.url).toContain('/api/files');
    expect(preview.body.week.days).toHaveLength(5);

    const start = await request(ctx.app).post(`/api/jobs/${jobId}/generate`).set(session.auth);
    expect(start.status).toBe(200);
    await processQueue(ctx);
    const generated = await waitForJob(ctx, jobId, (entry) => entry.status === 'generated');
    expect(generated.usage.previewsUsed).toBe(1);

    const weeks = await request(ctx.app).get(`/api/jobs/${jobId}/weeks`).set(session.auth);
    expect(weeks.body.weeks).toHaveLength(3);
    expect(weeks.body.weeks[0].days).toHaveLength(5);

    const credits = await request(ctx.app).get('/api/credits').set(session.auth);
    expect(credits.body.balance).toBe(0);
    expect(credits.body.reserved).toBe(0);

    const exported = await request(ctx.app).post(`/api/jobs/${jobId}/export`).set(session.auth);
    expect(exported.status).toBe(200);
    expect(exported.body.url).toContain('/api/files');
    expect(exported.body.kind).toBe('document');

    const download = await request(ctx.app).get(`/api/jobs/${jobId}/download`).set(session.auth);
    expect(download.status).toBe(200);
    expect(download.body.url).toBeTruthy();

    const file = await request(ctx.app).get(new URL(download.body.url).pathname + new URL(download.body.url).search);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.body.byteLength ?? file.body.length).toBeGreaterThan(1000);
  });

  it('lets the student edit an entry for free and re-export', async () => {
    const weeks = await request(ctx.app).get(`/api/jobs/${jobId}/weeks`).set(session.auth);
    const first = weeks.body.weeks[0];
    const edited = await request(ctx.app)
      .put(`/api/jobs/${jobId}/weeks/1`)
      .set(session.auth)
      .send({ days: [{ date: first.days[0].date, entry: 'I edited this entry by hand.' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.week.days[0].entry).toBe('I edited this entry by hand.');
    expect(edited.body.week.days[0].edited).toBe(true);

    const reExport = await request(ctx.app).post(`/api/jobs/${jobId}/export`).set(session.auth);
    expect(reExport.status).toBe(200);
    expect(reExport.body.version).toBeGreaterThan(1);
  });

  it('keeps jobs private to their owner', async () => {
    const other = await signIn(ctx, 'other@test.local', 'Other Student');
    const response = await request(ctx.app).get(`/api/jobs/${jobId}`).set(other.auth);
    expect(response.status).toBe(404);
  });
});

describe('referrals', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('rewards both sides after the friend’s first qualifying top-up', async () => {
    const referrer = await signIn(ctx, 'referrer@test.local', 'Referrer One');
    await onboard(ctx, referrer);
    const code = referrer.user.referralCode as string;

    const token = ctx.token('friend@test.local', 'Friend Two');
    const friendAuth = { authorization: `Bearer ${token}` };
    const boot = await request(ctx.app)
      .post('/api/me/bootstrap')
      .set(friendAuth)
      .send({ referralCode: code });
    expect(boot.status).toBe(200);
    expect(boot.body.user.referredBy).toBe(referrer.uid);
    await onboard(ctx, { token, auth: friendAuth, uid: boot.body.user.uid, user: boot.body.user });

    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(friendAuth)
      .send({ packId: 'pack_1000' });
    const reference = init.body.reference as string;
    await ctx.store.merge(`payments/${reference}`, { mockPaid: true });
    const paid = await request(ctx.app).get(`/api/payments/verify/${reference}`).set(friendAuth);
    expect(paid.body.status).toBe('success');

    const stats = await request(ctx.app).get('/api/referrals').set(referrer.auth);
    expect(stats.body.rewarded).toBe(1);
    expect(stats.body.earnedCredits).toBe(20);

    const referrerMe = await request(ctx.app).get('/api/me').set(referrer.auth);
    expect(referrerMe.body.user.balance).toBe(20);

    const friendCredits = await request(ctx.app).get('/api/credits').set(friendAuth);
    expect(friendCredits.body.balance).toBe(110);

    // Verifying again must not double-credit.
    await request(ctx.app).get(`/api/payments/verify/${reference}`).set(friendAuth);
    const after = await request(ctx.app).get('/api/credits').set(friendAuth);
    expect(after.body.balance).toBe(110);
  });

  it('ignores a self-referral', async () => {
    const session = await signIn(ctx, 'self@test.local', 'Self Referrer');
    const code = session.user.referralCode as string;
    const again = await request(ctx.app)
      .post('/api/me/bootstrap')
      .set(session.auth)
      .send({ referralCode: code });
    expect(again.status).toBe(200);
    expect(again.body.user.referredBy).toBeUndefined();
  });
});
