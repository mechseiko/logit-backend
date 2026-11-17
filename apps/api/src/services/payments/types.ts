export interface InitializeInput {
  reference: string;
  amountKobo: number;
  email: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface VerifyResult {
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amountKobo: number;
  currency: string;
}

export interface PaymentsProvider {
  readonly name: string;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifyResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
