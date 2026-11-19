import { randomBytes } from 'node:crypto';
import type { PaymentRecord, UserProfile } from '@logit/shared';
import { creditsForCustomNaira, formatNaira, nairaToKobo, packById, validateCustomNaira } from '@logit/shared';
import type { AppConfig } from '../../config.js';
import type { Store } from '../../db/index.js';
import { badRequest, notFound, ApiError } from '../../errors.js';
import { CreditsService } from '../credits.js';
import { getPricing } from '../pricing.js';
import { ReferralsService } from '../referrals.js';
import { PaymentProviderError, type PaymentsProvider } from './types.js';

export interface InitializeResponse {
  authorizationUrl: string;
  reference: string;
  naira: number;
  credits: number;
}

export interface SettleResult {
  status: 'success' | 'pending' | 'failed';
  credits: number;
  balance?: number;
  message?: string;
}

export class PaymentsService {
  private readonly credits: CreditsService;

  constructor(
    private readonly store: Store,
    private readonly provider: PaymentsProvider,
    private readonly config: AppConfig,
    private readonly referrals: ReferralsService,
  ) {
    this.credits = new CreditsService(store);
  }

  async initialize(
    uid: string,
    input: { packId?: string; customNaira?: number },
  ): Promise<InitializeResponse> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('Account not found.');
    const pricing = await getPricing(this.store);

    let naira: number;
    let credits: number;
    let packId: string;

    if (input.packId) {
      const pack = packById(input.packId, pricing.packs);
      if (!pack) throw badRequest('Unknown credit pack.');
      naira = pack.naira;
      credits = pack.credits;
      packId = pack.id;
    } else if (typeof input.customNaira === 'number') {
      const problem = validateCustomNaira(input.customNaira);
      if (problem) throw badRequest(problem);
      naira = input.customNaira;
      credits = creditsForCustomNaira(naira, pricing);
      packId = 'custom';
    } else {
      throw badRequest('Choose a credit pack or enter an amount.');
    }

    const existing = await this.store.query<PaymentRecord>('payments', {
      where: [
        ['uid', '==', uid],
        ['status', '==', 'success'],
      ],
      limit: 1,
    });

    const reference = `LGT_${uid.slice(0, 8)}_${Date.now()}_${randomBytes(3).toString('hex')}`;
    const payment: PaymentRecord = {
      reference,
      uid,
      naira,
      credits,
      packId,
      status: 'initialized',
      provider: this.provider.name,
      createdAt: new Date().toISOString(),
      firstPayment: existing.length === 0,
    };
    await this.store.set(`payments/${reference}`, payment);

    try {
      const { authorizationUrl } = await this.provider.initialize({
        reference,
        amountKobo: nairaToKobo(naira),
        email: user.email,
        callbackUrl: `${this.config.appUrl}/app/credits?reference=${encodeURIComponent(reference)}`,
        metadata: { uid, packId },
      });
      return { authorizationUrl, reference, naira, credits };
    } catch (error) {
      await this.store.merge(`payments/${reference}`, { status: 'failed' });
      if (error instanceof PaymentProviderError) {
        throw new ApiError(502, 'PAYMENT_ERROR', error.message);
      }
      throw new ApiError(502, 'PAYMENT_ERROR', 'We could not start the payment. Try again.');
    }
  }

  async settle(reference: string): Promise<SettleResult> {
    const payment = await this.store.get<PaymentRecord>(`payments/${reference}`);
    if (!payment) throw notFound('Payment not found.');
    if (payment.status === 'success') {
      const { balance } = await this.credits.balance(payment.uid);
      return { status: 'success', credits: payment.credits, balance };
    }

    let verification;
    try {
      verification = await this.provider.verify(reference);
    } catch (error) {
      throw new ApiError(
        502,
        'PAYMENT_ERROR',
        error instanceof Error ? error.message : 'Could not verify the payment.',
      );
    }

    if (verification.status === 'pending') {
      return { status: 'pending', credits: 0, message: 'Waiting for the payment to complete.' };
    }
    if (verification.status === 'failed') {
      await this.store.merge(`payments/${reference}`, { status: 'failed' });
      return { status: 'failed', credits: 0, message: 'The payment did not go through.' };
    }

    if (verification.currency !== 'NGN') {
      throw new ApiError(400, 'PAYMENT_ERROR', 'Only naira payments are accepted.');
    }
    if (verification.amountKobo !== nairaToKobo(payment.naira)) {
      await this.store.merge(`payments/${reference}`, { status: 'failed' });
      throw new ApiError(
        400,
        'PAYMENT_ERROR',
        `Amount mismatch: expected ${formatNaira(payment.naira)}.`,
      );
    }

    // Credits first, then the paid flag. `purchase` is keyed on the reference, so a crash in
    // between leaves an initialized payment that the next webhook/verify retries safely; the
    // reverse order used to strand a paid student with no credits and no retry path.
    await this.credits.purchase(payment.uid, reference, payment.credits);

    const claim = await this.store.transaction(async (tx) => {
      const fresh = await tx.get<PaymentRecord>(`payments/${reference}`);
      const user = await tx.get<UserProfile>(`users/${payment.uid}`);
      if (!fresh || !user) throw notFound('Payment not found.');
      if (fresh.status === 'success') return { already: true, balance: user.balance };
      tx.set(`payments/${reference}`, {
        ...fresh,
        status: 'success',
        verifiedAt: new Date().toISOString(),
      });
      tx.set(`users/${payment.uid}`, {
        ...user,
        totalPaidNaira: user.totalPaidNaira + payment.naira,
      });
      return { already: false, balance: user.balance };
    });

    if (!claim.already) {
      const settled: PaymentRecord = { ...payment, status: 'success' };
      await this.referrals.rewardForPayment(payment.uid, settled);
    }
    const { balance } = await this.credits.balance(payment.uid);
    return { status: 'success', credits: payment.credits, balance };
  }

  async verifyForUser(uid: string, reference: string): Promise<SettleResult> {
    const payment = await this.store.get<PaymentRecord>(`payments/${reference}`);
    if (!payment || payment.uid !== uid) throw notFound('Payment not found.');
    return this.settle(reference);
  }

  /**
   * Local simulator only: marks a payment as paid so the normal verify + settle path runs.
   * Refused for the real provider and in production.
   */
  async simulatePayment(uid: string, reference: string): Promise<void> {
    if (this.provider.name !== 'mock' || this.config.isProd) throw notFound('Payment not found.');
    const payment = await this.store.get<PaymentRecord>(`payments/${reference}`);
    if (!payment || payment.uid !== uid) throw notFound('Payment not found.');
    await this.store.merge(`payments/${reference}`, { mockPaid: true });
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ handled: boolean }> {    if (!this.provider.verifyWebhookSignature(rawBody, signature)) {
      throw new ApiError(401, 'PAYMENT_ERROR', 'Invalid webhook signature.');
    }
    let event: { event?: string; data?: { reference?: string } };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw badRequest('Webhook body is not JSON.');
    }
    if (event.event !== 'charge.success' || !event.data?.reference) return { handled: false };
    await this.settle(event.data.reference);
    return { handled: true };
  }

  async history(uid: string, limit = 20): Promise<PaymentRecord[]> {
    return this.store.query<PaymentRecord>('payments', {
      where: [['uid', '==', uid]],
      orderBy: [['createdAt', 'desc']],
      limit,
    });
  }
}
