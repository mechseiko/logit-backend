import type { PaymentRecord, UserProfile } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { CreditsService } from './credits.js';
import { getPricing } from './pricing.js';

export interface ReferralDoc {
  referredUid: string;
  referrerUid: string;
  code: string;
  status: 'pending' | 'rewarded' | 'void';
  createdAt: string;
  paymentRef?: string;
  rewardedAt?: string;
}

export interface ReferralStats {
  code: string;
  link: string;
  pending: number;
  rewarded: number;
  earnedCredits: number;
  cap: number;
  rewards: { referrerCredits: number; friendCredits: number; minNaira: number };
}

export class ReferralsService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
  ) {}

  async stats(uid: string): Promise<ReferralStats> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    const pricing = await getPricing(this.store);
    const all = await this.store.query<ReferralDoc>('referrals', {
      where: [['referrerUid', '==', uid]],
    });
    const rewarded = all.filter((r) => r.status === 'rewarded').length;
    return {
      code: user?.referralCode ?? '',
      link: `${this.config.appUrl}/r/${user?.referralCode ?? ''}`,
      pending: all.filter((r) => r.status === 'pending').length,
      rewarded,
      earnedCredits: rewarded * pricing.referral.referrerCredits,
      cap: pricing.referral.capPerReferrer,
      rewards: {
        referrerCredits: pricing.referral.referrerCredits,
        friendCredits: pricing.referral.friendCredits,
        minNaira: pricing.referral.minNaira,
      },
    };
  }

  /** Called after a successful top-up. Rewards only the friend's first qualifying payment, once. */
  async rewardForPayment(referredUid: string, payment: PaymentRecord): Promise<boolean> {
    if (payment.status !== 'success') return false;
    // The referral promise is about the friend's FIRST top-up, not any later one.
    if (payment.firstPayment !== true) return false;
    const pricing = await getPricing(this.store);
    if (payment.naira < pricing.referral.minNaira) return false;

    const referral = await this.store.get<ReferralDoc>(`referrals/${referredUid}`);
    if (!referral || referral.status !== 'pending') return false;
    const referrer = await this.store.get<UserProfile>(`users/${referral.referrerUid}`);
    if (!referrer || referrer.banned || referrer.uid === referredUid) {
      await this.store.merge(`referrals/${referredUid}`, { status: 'void' });
      return false;
    }

    const rewarded = await this.store.query<ReferralDoc>('referrals', {
      where: [
        ['referrerUid', '==', referral.referrerUid],
        ['status', '==', 'rewarded'],
      ],
    });
    if (rewarded.length >= pricing.referral.capPerReferrer) {
      await this.store.merge(`referrals/${referredUid}`, { status: 'void' });
      return false;
    }

    const credits = new CreditsService(this.store);
    await credits.referralCredits(
      referrer.uid,
      referredUid,
      pricing.referral.referrerCredits,
      'reward',
    );
    await credits.referralCredits(referredUid, referredUid, pricing.referral.friendCredits, 'bonus');
    await this.store.merge(`referrals/${referredUid}`, {
      status: 'rewarded',
      paymentRef: payment.reference,
      rewardedAt: new Date().toISOString(),
    });
    return true;
  }
}
