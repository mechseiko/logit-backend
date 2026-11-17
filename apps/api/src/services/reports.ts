import { randomUUID } from 'node:crypto';
import type { ReportFacts, ReportOutput } from '@logit/shared';
import { insufficientCredits } from '../errors.js';
import type { Store } from '../db/index.js';
import type { AiProvider } from './ai/index.js';
import { generateValidatedReport } from './ai/index.js';
import { CreditsService } from './credits.js';
import { getPricing } from './pricing.js';

/**
 * Project/school reports: same honesty contract as logbook weeks —
 * the model only ever sees redacted student facts.
 */
export class ReportsService {
  private readonly credits: CreditsService;

  constructor(
    private readonly store: Store,
    private readonly ai: AiProvider,
  ) {
    this.credits = new CreditsService(store);
  }

  async generate(
    uid: string,
    input: ReportFacts,
  ): Promise<{ report: ReportOutput; charged: number; balance: number; removed: string[] }> {
    const pricing = await getPricing(this.store);
    const cost = pricing.reportCost;
    const chargeId = `report:${randomUUID()}`;

    if (cost > 0) {
      const { balance } = await this.credits.balance(uid);
      if (balance < cost) throw insufficientCredits(cost, balance);
      await this.credits.charge(uid, {
        id: chargeId,
        ref: 'report',
        amount: cost,
        type: 'report',
        note: 'Project report',
      });
    }

    try {
      const profile = await this.store.get<{ displayName?: string }>(`users/${uid}`);
      const { output, removed } = await generateValidatedReport({
        provider: this.ai,
        input,
        studentName: profile?.displayName,
      });
      const { balance } = await this.credits.balance(uid);
      return { report: output, charged: cost, balance, removed };
    } catch (error) {
      if (cost > 0) {
        await this.credits
          .refundCharge(uid, chargeId, cost, 'Report failed — credits returned')
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
