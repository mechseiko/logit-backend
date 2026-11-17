import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, signIn, type SignedIn, type TestContext } from './helpers.js';
import { ApiError } from '../src/errors.js';

describe('credit ledger', () => {
  let ctx: TestContext;
  let session: SignedIn;

  beforeAll(async () => {
    ctx = await createTestContext();
    session = await signIn(ctx, 'credits@test.local');
    await ctx.store.merge(`users/${session.uid}`, { balance: 500 });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('reserves, commits and releases idempotently', async () => {
    const { credits } = ctx.services;
    const first = await credits.reserve(session.uid, 'job_a', 30);
    expect(first.balance).toBe(470);
    expect(first.reserved).toBe(30);
    expect(first.applied).toBe(true);

    const repeat = await credits.reserve(session.uid, 'job_a', 30);
    expect(repeat.applied).toBe(false);
    expect(repeat.balance).toBe(470);

    await credits.commit(session.uid, 'job_a', 30);
    const state = await credits.balance(session.uid);
    expect(state).toEqual({ balance: 470, reserved: 0 });

    const commitAgain = await credits.commit(session.uid, 'job_a', 30);
    expect(commitAgain.applied).toBe(false);
    expect((await credits.balance(session.uid)).reserved).toBe(0);
  });

  it('releases reserved credits on failure', async () => {
    const { credits } = ctx.services;
    await credits.reserve(session.uid, 'job_b', 40);
    expect((await credits.balance(session.uid)).reserved).toBe(40);
    await credits.release(session.uid, 'job_b', 40);
    const state = await credits.balance(session.uid);
    expect(state).toEqual({ balance: 470, reserved: 0 });
    const again = await credits.release(session.uid, 'job_b', 40);
    expect(again.applied).toBe(false);
  });

  it('refuses to reserve more credits than the balance', async () => {
    const { credits } = ctx.services;
    await expect(credits.reserve(session.uid, 'job_c', 10_000)).rejects.toBeInstanceOf(ApiError);
    const state = await credits.balance(session.uid);
    expect(state).toEqual({ balance: 470, reserved: 0 });
  });

  it('charges metered extras once per id', async () => {
    const { credits } = ctx.services;
    await credits.charge(session.uid, {
      id: 'regen:job_d:1:3',
      ref: 'job_d',
      amount: 5,
      type: 'regen',
      note: 'extra regeneration',
    });
    const repeat = await credits.charge(session.uid, {
      id: 'regen:job_d:1:3',
      ref: 'job_d',
      amount: 5,
      type: 'regen',
    });
    expect(repeat.applied).toBe(false);
    expect((await credits.balance(session.uid)).balance).toBe(465);
  });

  it('records an immutable audit trail with running balances', async () => {
    const entries = await ctx.services.credits.list(session.uid);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.balanceAfter).toBeGreaterThanOrEqual(0);
    }
    const reserve = entries.find((entry) => entry.ref === 'job_a' && entry.type === 'reserve');
    expect(reserve?.amount).toBe(-30);
  });
});
