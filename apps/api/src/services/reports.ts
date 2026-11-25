import { randomUUID } from 'node:crypto';
import {
  OAU_IT_REPORT,
  type ReportFacts,
  type ReportGenerateInput,
  type ReportOutput,
} from '@logit/shared';
import { insufficientCredits } from '../errors.js';
import type { Store } from '../db/index.js';
import type { AiProvider } from './ai/index.js';
import { generateValidatedReport } from './ai/index.js';
import { CreditsService } from './credits.js';
import { loadFontBytes } from './fonts.js';
import { buildReportDocument } from './pdf/reportDoc.js';
import { getPricing } from './pricing.js';
import type { StorageAdapter } from './storage/index.js';

/**
 * Reports: the chaptered document a school expects, written only from the student's own facts.
 *
 * The literature chapter is the honest edge: it may only use sources the student listed, so a
 * request with no sources produces a report with no literature chapter rather than invented
 * citations.
 */
export class ReportsService {
  private readonly credits: CreditsService;

  constructor(
    private readonly store: Store,
    private readonly ai: AiProvider,
    private readonly storage: StorageAdapter,
  ) {
    this.credits = new CreditsService(store);
  }

  async generate(
    uid: string,
    input: ReportGenerateInput,
  ): Promise<{
    report: ReportOutput;
    charged: number;
    balance: number;
    removed: string[];
    pages: number;
    url: string;
  }> {
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
        note: 'Report',
      });
    }

    try {
      const account = await this.store.get<{ displayName?: string }>(`users/${uid}`);
      const facts: ReportFacts = {
        title: input.title,
        course: input.course,
        institution: input.institution,
        durationWeeks: input.durationWeeks,
        company: input.company,
        objectives: input.objectives,
        activities: input.activities,
        tools: input.tools,
        problems: input.problems,
        solutions: input.solutions,
        outcomes: input.outcomes,
        sources: input.sources,
      };
      const { output, removed } = await generateValidatedReport({
        provider: this.ai,
        input: facts,
        studentName: account?.displayName,
      });

      // A chapter with no body is dropped rather than printed as an empty heading.
      const chapters = output.sections.filter((section) => section.body.trim().length > 0);
      const fontBytes = await loadFontBytes();
      const { bytes, pages } = await buildReportDocument(
        {
          template: OAU_IT_REPORT,
          facts,
          sections: chapters,
          student: {
            name: input.studentName || account?.displayName || '',
            matricNo: input.matricNo,
            department: input.department,
            institution: input.institution ?? '',
          },
          fontFamily: input.fontFamily,
        },
        fontBytes,
      );

      const key = `reports/${uid}/${randomUUID()}.pdf`;
      await this.storage.put(key, bytes, 'application/pdf');
      const { balance } = await this.credits.balance(uid);
      return {
        report: { ...output, sections: chapters },
        charged: cost,
        balance,
        removed,
        pages,
        url: await this.storage.signedGetUrl(
          key,
          `${input.title.replace(/[^\w\s-]/g, '').slice(0, 60) || 'report'}.pdf`,
          900,
        ),
      };
    } catch (error) {
      if (cost > 0) {
        await this.credits
          .refundCharge(uid, chargeId, cost, 'Report failed - credits returned')
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
