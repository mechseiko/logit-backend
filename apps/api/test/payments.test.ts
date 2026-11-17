import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PaymentRecord } from '@logit/shared';
import { createTestContext, signIn, type SignedIn, type TestContext } from './helpers.js';
import { PaymentsService } from '../src/services/payments/service.js';
import { PaystackProvider } from '../src/services/payments/paystack.js';
import type { PaymentsProvider } from '../src/services/payments/types.js';
import { ApiError } from '../src/errors.js';

describe('payments', () => {
  let ctx: TestContext;
  let session: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'payments@test.local');
  });
  afterAll(async () => {
    await ctx.close();
  });

  const makePayment = async (reference: string, naira = 1000, credits = 100) => {
    const payment: PaymentRecord = {
      reference,
      uid: session.uid,
      naira,
      credits,
      packId: 'pack_1000',
      status: 'initialized',
      provider: 'fake',
      createdAt: new Date().toISOString(),
      firstPayment: true,
    };
    await ctx.store.set(`payments/${reference}`, payment);
    return payment;
  };

  it('leaves a payment pending until the provider confirms it', async () => {
    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(session.auth)
      .send({ customNaira: 2500 });
    expect(init.status).toBe(200);
    expect(init.body.credits).toBe(262); // floor(250 x 1.05)

    const verify = await request(ctx.app)
      .get(`/api/payments/verify/${init.body.reference}`)
      .set(session.auth);
    expect(verify.body.status).toBe('pending');
    expect(verify.body.credits).toBe(0);
  });

  it('rejects an amount mismatch and never credits the user', async () => {
    const provider: PaymentsProvider = {
      name: 'fake',
      initialize: async () => ({ authorizationUrl: 'http://example.test' }),
      verify: async (reference) => ({
        status: 'success',
        reference,
        amountKobo: 5,
        currency: 'NGN',
      }),
      verifyWebhookSignature: () => true,
    };
    const service = new PaymentsService(ctx.store, provider, ctx.config, ctx.services.referrals);
    await makePayment('LGT_mismatch', 1000);
    await expect(service.settle('LGT_mismatch')).rejects.toMatchObject({ code: 'PAYMENT_ERROR' });
    const payment = await ctx.store.get<PaymentRecord>('payments/LGT_mismatch');
    expect(payment?.status).toBe('failed');
    const { balance } = await ctx.services.credits.balance(session.uid);
    expect(balance).toBe(0);
  });

  it('rejects a non-NGN currency', async () => {
    const provider: PaymentsProvider = {
      name: 'fake',
      initialize: async () => ({ authorizationUrl: 'http://example.test' }),
      verify: async (reference) => ({
        status: 'success',
        reference,
        amountKobo: 100_000,
        currency: 'USD',
      }),
      verifyWebhookSignature: () => true,
    };
    const service = new PaymentsService(ctx.store, provider, ctx.config, ctx.services.referrals);
    await makePayment('LGT_usd', 1000);
    await expect(service.settle('LGT_usd')).rejects.toMatchObject({ code: 'PAYMENT_ERROR' });
  });

  it('verifies Paystack webhook signatures with HMAC SHA512', () => {
    const provider = new PaystackProvider('sk_test_secret');
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'LGT_x' } }));
    const signature = createHmac('sha512', 'sk_test_secret').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(provider.verifyWebhookSignature(body, tampered)).toBe(false);
    expect(provider.verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it('rejects a webhook with a bad signature before touching payments', async () => {
    const provider: PaymentsProvider = {
      name: 'paystack',
      initialize: async () => ({ authorizationUrl: 'http://example.test' }),
      verify: async () => ({ status: 'pending', reference: 'none', amountKobo: 0, currency: 'NGN' }),
      verifyWebhookSignature: () => false,
    };
    const service = new PaymentsService(ctx.store, provider, ctx.config, ctx.services.referrals);
    await expect(
      service.handleWebhook(Buffer.from('{"event":"charge.success"}'), 'bad'),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('does not credit twice when the same payment settles concurrently', async () => {
    const init = await request(ctx.app)
      .post('/api/payments/initialize')
      .set(session.auth)
      .send({ packId: 'pack_1000' });
    const reference = init.body.reference as string;
    await ctx.store.merge(`payments/${reference}`, { mockPaid: true });
    const results = await Promise.all([
      ctx.services.payments.settle(reference),
      ctx.services.payments.settle(reference),
    ]);
    expect(results.every((result) => result.status === 'success')).toBe(true);
    const { balance } = await ctx.services.credits.balance(session.uid);
    expect(balance).toBe(100);
  });
});
