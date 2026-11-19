import type { LedgerEntry, UserProfile } from '@logit/shared';
import { randomBytes } from 'node:crypto';
import type { Store, StoreTx } from '../db/index.js';
import { insufficientCredits, notFound } from '../errors.js';

export type LedgerKind = 'reserve' | 'commit' | 'release';

/** Deterministic ids make reserve/commit/release idempotent. Retries get an attempt suffix. */
export function ledgerId(kind: LedgerKind, jobId: string, attempt = 1): string {
  return attempt <= 1 ? `${kind}:${jobId}` : `${kind}:${jobId}:${attempt}`;
}

export function regenLedgerId(jobId: string, week: number, n: number): string {
  return `regen:${jobId}:${week}:${n}`;
}

export function chatLedgerId(jobId: string, n: number): string {
  return `chat:${jobId}:${n}`;
}

interface ApplyInput {
  uid: string;
  id: string;
  amount: number;
  type: LedgerEntry['type'];
  ref: string;
  note?: string;
  reservedDelta?: number;
}

export interface CreditState {
  balance: number;
  reserved: number;
  applied: boolean;
}

export class CreditsService {
  constructor(private readonly store: Store) {}

  private async apply(input: ApplyInput): Promise<CreditState> {
    return this.store.transaction(async (tx: StoreTx) => {
      const existing = await tx.get<LedgerEntry>(`creditLedger/${input.id}`);
      const user = await tx.get<UserProfile>(`users/${input.uid}`);
      if (!user) throw notFound('Account not found.');
      if (existing) return { balance: user.balance, reserved: user.reserved, applied: false };
      const balance = user.balance + input.amount;
      const reserved = user.reserved + (input.reservedDelta ?? 0);
      if (balance < 0) throw insufficientCredits(-input.amount, user.balance);
      if (reserved < 0) throw new Error('Reserved credits would go negative.');
      tx.set(`users/${input.uid}`, { ...user, balance, reserved });
      const entry: LedgerEntry = {
        id: input.id,
        uid: input.uid,
        type: input.type,
        amount: input.amount,
        balanceAfter: balance,
        reservedAfter: reserved,
        ref: input.ref,
        note: input.note,
        createdAt: new Date().toISOString(),
      };
      tx.set(`creditLedger/${input.id}`, entry);
      return { balance, reserved, applied: true };
    });
  }

  async reserve(uid: string, jobId: string, cost: number, attempt = 1): Promise<CreditState> {
    return this.apply({
      uid,
      id: ledgerId('reserve', jobId, attempt),
      amount: -cost,
      reservedDelta: cost,
      type: 'reserve',
      ref: jobId,
      note: `Reserved for generation (attempt ${attempt})`,
    });
  }

  async commit(uid: string, jobId: string, cost: number, attempt = 1): Promise<CreditState> {
    return this.apply({
      uid,
      id: ledgerId('commit', jobId, attempt),
      amount: 0,
      reservedDelta: -cost,
      type: 'commit',
      ref: jobId,
      note: 'Generation completed',
    });
  }

  async release(uid: string, jobId: string, cost: number, attempt = 1): Promise<CreditState> {
    return this.apply({
      uid,
      id: ledgerId('release', jobId, attempt),
      amount: cost,
      reservedDelta: -cost,
      type: 'release',
      ref: jobId,
      note: 'Generation failed — credits returned',
    });
  }

  async purchase(uid: string, reference: string, credits: number): Promise<CreditState> {
    return this.apply({
      uid,
      id: `purchase:${reference}`,
      amount: credits,
      type: 'purchase',
      ref: reference,
      note: 'Top-up',
    });
  }

  async referralCredits(uid: string, referredUid: string, credits: number, kind: 'reward' | 'bonus'): Promise<CreditState> {
    return this.apply({
      uid,
      id: `referral_${kind}:${referredUid}`,
      amount: credits,
      type: kind === 'reward' ? 'referral_reward' : 'referral_bonus',
      ref: referredUid,
      note: kind === 'reward' ? 'Referral reward' : 'Referral welcome bonus',
    });
  }

  async charge(
    uid: string,
    options: { id: string; ref: string; amount: number; type: 'regen' | 'chat' | 'report'; note?: string },
  ): Promise<CreditState> {
    if (options.amount <= 0) throw new Error('Charge amount must be positive.');
    return this.apply({
      uid,
      id: options.id,
      amount: -options.amount,
      type: options.type,
      ref: options.ref,
      note: options.note,
    });
  }

  /** Returns a metered charge when the paid action failed. Deterministic id keeps it idempotent. */
  async refundCharge(uid: string, chargeId: string, amount: number, note: string): Promise<CreditState> {
    return this.apply({
      uid,
      id: `${chargeId}:refund`,
      amount,
      type: 'adjustment',
      ref: chargeId,
      note,
    });
  }

  async adjust(uid: string, amount: number, reason: string): Promise<CreditState> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('User not found.');
    const id = `adjustment:${Date.now()}:${randomBytes(3).toString('hex')}`;
    return this.apply({ uid, id, amount, type: 'adjustment', ref: 'admin', note: reason });
  }

  async balance(uid: string): Promise<{ balance: number; reserved: number }> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('Account not found.');
    return { balance: user.balance, reserved: user.reserved };
  }

  async list(uid: string, limit = 40, cursor?: string): Promise<LedgerEntry[]> {
    const entries = await this.store.query<LedgerEntry>('creditLedger', {
      where: cursor
        ? [
            ['uid', '==', uid],
            ['createdAt', '<', cursor],
          ]
        : [['uid', '==', uid]],
      orderBy: [['createdAt', 'desc']],
      limit,
    });
    return entries;
  }
}
