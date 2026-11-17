import type { AppConfig } from '../../config.js';
import type { Store } from '../../db/index.js';
import { MockPaymentsProvider } from './mock.js';
import { PaystackProvider } from './paystack.js';
import type { PaymentsProvider } from './types.js';

export * from './types.js';
export { PaymentsService } from './service.js';

export function createPaymentsProvider(store: Store, config: AppConfig): PaymentsProvider {
  if (config.isProd && config.paymentsProvider !== 'paystack') {
    throw new Error('PAYMENTS_PROVIDER must be paystack in production.');
  }
  if (config.paymentsProvider === 'paystack') return new PaystackProvider(config.paystackSecretKey);
  return new MockPaymentsProvider(store, config);
}
