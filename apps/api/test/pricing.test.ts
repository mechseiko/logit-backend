import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, signIn, type SignedIn, type TestContext } from './helpers.js';

const basePricing = {
  packs: [{ id: 'pack_1000', naira: 1000, credits: 100 }],
  bonusBrackets: [{ minNaira: 0, bonus: 0 }],
  sizeTiers: [{ maxWeeks: 9999, credits: 400 }],
  regenCost: 7,
  chatFreeMessages: 5,
  chatCost: 2,
  reportCost: 10,
  referral: { referrerCredits: 25, friendCredits: 5, minNaira: 2000, capPerReferrer: 10 },
};

describe('pricing source of truth', () => {
  let ctx: TestContext;
  let admin: SignedIn;
  let user: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    admin = await signIn(ctx, 'admin@logit.test', 'Admin');
    user = await signIn(ctx, 'pricing@test.local', 'Pricing User');
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('rejects zero credits, negative values and bonuses above 100%', async () => {
    const zero = await request(ctx.app)
      .put('/api/admin/config/pricing')
      .set(admin.auth)
      .send({ ...basePricing, packs: [{ id: 'pack_1000', naira: 1000, credits: 0 }] });
    expect(zero.status).toBe(400);

    const negative = await request(ctx.app)
      .put('/api/admin/config/pricing')
      .set(admin.auth)
      .send({ ...basePricing, regenCost: -1 });
    expect(negative.status).toBe(400);

    const bonus = await request(ctx.app)
      .put('/api/admin/config/pricing')
      .set(admin.auth)
      .send({ ...basePricing, bonusBrackets: [{ minNaira: 0, bonus: 2 }] });
    expect(bonus.status).toBe(400);
  });

  it('uses the stored config for pack amounts, credits and custom amounts', async () => {
    const update = await request(ctx.app)
      .put('/api/admin/config/pricing')
      .set(admin.auth)
      .send({
        ...basePricing,
        packs: [{ id: 'pack_1000', naira: 1200, credits: 150 }],
        sizeTiers: [
          { maxWeeks: 8, credits: 50 },
          { maxWeeks: 9999, credits: 400 },
        ],
      });
    expect(update.status).toBe(200);

    const publicPricing = await request(ctx.app).get('/api/pricing');
    expect(publicPricing.body.pricing.packs[0]).toMatchObject({ naira: 1200, credits: 150 });
    expect(publicPricing.body.pricing.sizeTiers[0].credits).toBe(50);

    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(user.auth)
      .send({ packId: 'pack_1000' });
    expect(init.status).toBe(200);
    expect(init.body.naira).toBe(1200);
    expect(init.body.credits).toBe(150);

    await ctx.store.merge(`payments/${init.body.reference}`, { mockPaid: true });
    const paid = await request(ctx.app)
      .get(`/api/payments/verify/${init.body.reference}`)
      .set(user.auth);
    expect(paid.body.status).toBe('success');
    expect(paid.body.credits).toBe(150);

    const custom = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(user.auth)
      .send({ customNaira: 2500 });
    expect(custom.status).toBe(200);
    expect(custom.body.credits).toBe(250); // stored bonus for 2500 is 0%
    expect(custom.body.naira).toBe(2500);
  });

  it('still enforces the shared custom-amount boundaries', async () => {
    const low = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(user.auth)
      .send({ customNaira: 500 });
    expect(low.status).toBe(400);
    const odd = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(user.auth)
      .send({ customNaira: 1050 });
    expect(odd.status).toBe(400);
  });
});
