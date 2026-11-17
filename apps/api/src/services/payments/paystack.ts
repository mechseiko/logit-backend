import crypto from 'node:crypto';
import type { InitializeInput, PaymentsProvider, VerifyResult } from './types.js';
import { PaymentProviderError } from './types.js';

const BASE = 'https://api.paystack.co';

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data?: T;
}

export class PaystackProvider implements PaymentsProvider {
  readonly name = 'paystack';

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is required.');
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => null)) as PaystackResponse<T> | null;
    if (!response.ok || !body?.status || !body.data) {
      throw new PaymentProviderError(body?.message ?? 'Paystack did not accept this request.');
    }
    return body.data;
  }

  async initialize(input: InitializeInput): Promise<{ authorizationUrl: string }> {
    const data = await this.call<{ authorization_url: string; reference: string }>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          reference: input.reference,
          amount: input.amountKobo,
          email: input.email,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      },
    );
    return { authorizationUrl: data.authorization_url };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await this.call<{
      status: string;
      amount: number;
      currency: string;
      reference: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status === 'success' ? 'success' : data.status === 'failed' || data.status === 'abandoned' ? 'failed' : 'pending',
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
}
