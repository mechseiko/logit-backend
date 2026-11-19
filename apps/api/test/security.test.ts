import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, signIn, type SignedIn, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('authorization', () => {
  it('only confirms referral codes that exist', async () => {
    const miss = await request(ctx.app).get('/api/referrals/validate/NOPE1234');
    expect(miss.status).toBe(200);
    expect(miss.body.valid).toBe(false);

    const user = await signIn(ctx, 'invite-owner@test.local', 'Invite Owner');
    const profile = await ctx.store.get<{ referralCode: string }>(`users/${user.uid}`);
    const hit = await request(ctx.app).get(`/api/referrals/validate/${profile!.referralCode}`);
    expect(hit.status).toBe(200);
    expect(hit.body.valid).toBe(true);
  });

  it('makes the ADMIN_BOOTSTRAP_EMAIL an admin and blocks everyone else', async () => {
    const admin = await signIn(ctx, 'admin@logit.test', 'Admin');
    const adminMe = await request(ctx.app).get('/api/me').set(admin.auth);
    expect(adminMe.body.isAdmin).toBe(true);

    const stats = await request(ctx.app).get('/api/admin/stats').set(admin.auth);
    expect(stats.status).toBe(200);
    expect(stats.body.users).toBeGreaterThan(0);

    const normal = await signIn(ctx, 'normal@test.local', 'Normal');
    const blocked = await request(ctx.app).get('/api/admin/stats').set(normal.auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects unauthenticated API calls', async () => {
    const response = await request(ctx.app).get('/api/jobs');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('blocks banned accounts on every call', async () => {
    const session = await signIn(ctx, 'banned@test.local', 'Banned User');
    await ctx.store.merge(`users/${session.uid}`, { banned: true });
    const response = await request(ctx.app).get('/api/jobs').set(session.auth);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('BANNED');
  });

  it('audits admin credit adjustments', async () => {
    const admin = await signIn(ctx, 'admin@logit.test', 'Admin');
    const user = await signIn(ctx, 'adjusted@test.local', 'Adjusted User');
    const response = await request(ctx.app)
      .post(`/api/admin/users/${user.uid}/adjust`)
      .set(admin.auth)
      .send({ amount: 25, reason: 'Goodwill for a failed generation' });
    expect(response.status).toBe(200);
    expect(response.body.user.balance).toBe(25);

    const me = await request(ctx.app).get('/api/me').set(user.auth);
    expect(me.body.user.balance).toBe(25);

    const audit = await request(ctx.app).get('/api/admin/audit').set(admin.auth);
    expect(audit.body.entries.some((entry: { action: string }) => entry.action === 'user.adjust')).toBe(true);
  });

  it('validates intake answers before saving', async () => {
    const session = await signIn(ctx, 'validation@test.local', 'Validation User');
    const response = await request(ctx.app)
      .put('/api/jobs/does-not-exist/intake')
      .set(session.auth)
      .send({ intake: { company: 'x' } });
    expect([400, 404]).toContain(response.status);
  });
});

describe('admin protections', () => {
  let admin: SignedIn;
  let user: SignedIn;

  beforeAll(async () => {
    admin = await signIn(ctx, 'admin@logit.test', 'Admin Two');
    user = await signIn(ctx, 'protected@test.local', 'Protected');
  });

  it('refuses to let an admin ban themselves', async () => {
    const response = await request(ctx.app)
      .post(`/api/admin/users/${admin.uid}/ban`)
      .set(admin.auth)
      .send({ banned: true, reason: 'testing' });
    expect(response.status).toBe(400);
  });

  it('bans and unbans another user', async () => {
    const ban = await request(ctx.app)
      .post(`/api/admin/users/${user.uid}/ban`)
      .set(admin.auth)
      .send({ banned: true, reason: 'Abusive uploads' });
    expect(ban.status).toBe(200);
    expect(ban.body.user.banned).toBe(true);
    const blocked = await request(ctx.app).get('/api/jobs').set(user.auth);
    expect(blocked.status).toBe(403);

    const unban = await request(ctx.app)
      .post(`/api/admin/users/${user.uid}/ban`)
      .set(admin.auth)
      .send({ banned: false, reason: 'Appeal accepted' });
    expect(unban.body.user.banned).toBe(false);
    const allowed = await request(ctx.app).get('/api/jobs').set(user.auth);
    expect(allowed.status).toBe(200);
  });
});
