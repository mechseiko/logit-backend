import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, type TestContext } from './helpers.js';

/**
 * The API sits behind Render's proxy. With `trust proxy` unset, every request would carry the
 * proxy's address and all students would share a single rate-limit bucket. These tests pin the
 * per-IP behaviour and the limit configuration.
 */
describe('rate limiting behind the proxy', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({
      trustProxy: 1,
      rateLimit: { windowMs: 60_000, api: 2, public: 100 },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('counts requests per client address from X-Forwarded-For', async () => {
    const call = (ip: string) =>
      request(ctx.app).get('/api/me').set('authorization', 'Bearer invalid').set('x-forwarded-for', ip);

    expect((await call('203.0.113.10')).status).toBe(401);
    expect((await call('203.0.113.10')).status).toBe(401);
    // Third request from the same address hits the (deliberately tiny) limit.
    const blocked = await call('203.0.113.10');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // A different student behind the same proxy is unaffected.
    expect((await call('198.51.100.7')).status).toBe(401);
    expect((await call('198.51.100.7')).status).toBe(401);
  });

  it('shares one bucket when the proxy is not trusted (the bug this pins)', async () => {
    const direct = await createTestContext({
      trustProxy: false,
      rateLimit: { windowMs: 60_000, api: 2, public: 100 },
    });
    try {
      const call = (ip: string) =>
        request(direct.app)
          .get('/api/me')
          .set('authorization', 'Bearer invalid')
          .set('x-forwarded-for', ip);
      expect((await call('203.0.113.10')).status).toBe(401);
      expect((await call('198.51.100.7')).status).toBe(401);
      // Without trust proxy both addresses look like the same peer, so the third call is blocked.
      expect((await call('192.0.2.44')).status).toBe(429);
    } finally {
      await direct.close();
    }
  });

  it('exposes the production limits through configuration', async () => {
    expect(ctx.config.rateLimit.api).toBe(2);
    expect(ctx.config.trustProxy).toBe(1);
  });
});
