import type { PaymentRecord } from '@logit/shared';
import type { AppConfig } from '../../config.js';
import type { Store } from '../../db/index.js';
import type { InitializeInput, PaymentsProvider, VerifyResult } from './types.js';

/**
 * Local payment simulator used only by tests and local development
 * (PAYMENTS_PROVIDER=mock is refused in production). `markMockPaid` flips
 * `mockPaid`, then the normal verify + settle path runs unchanged.
 */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = 'mock';

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
  ) {}

  async initialize(input: InitializeInput): Promise<{ authorizationUrl: string }> {
    const url = new URL('/app/credits', this.config.appUrl);
    url.searchParams.set('mock_reference', input.reference);
    return { authorizationUrl: url.toString() };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const payment = await this.store.get<PaymentRecord>(`payments/${reference}`);
    if (!payment) {
      return { status: 'pending', reference, amountKobo: 0, currency: 'NGN' };
    }
    if (!payment.mockPaid) {
      return { status: 'pending', reference, amountKobo: payment.naira * 100, currency: 'NGN' };
    }
    return {
      status: 'success',
      reference,
      amountKobo: payment.naira * 100,
      currency: 'NGN',
    };
  }

  verifyWebhookSignature(_rawBody: Buffer, _signature: string | undefined): boolean {
    // Local simulator only; no signed third-party calls exist.
    return true;
  }
}
