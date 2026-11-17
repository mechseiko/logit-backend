import {
  LIMITS,
  approximateCharsPerLine,
  maxLinesFor,
  redact,
  weekdayName,
  type DayEntry,
  type Job,
  type WeekGroup,
  type WeekRecord,
} from '@logit/shared';
import { ApiError, conflict, insufficientCredits, notFound } from '../errors.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { AiProvider, WeekInput } from './ai/index.js';
import { generateValidatedWeek } from './ai/index.js';
import { CreditsService, regenLedgerId, chatLedgerId } from './credits.js';
import { placeRect } from './fill.js';
import { getPricing } from './pricing.js';
import type { TemplatesService } from './templates.js';

function rateDocId(uid: string): string {
  return `${uid}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}

export class GenerationService {
  private readonly credits: CreditsService;

  constructor(
    private readonly store: Store,
    private readonly ai: AiProvider,
    private readonly config: AppConfig,
    private readonly templates: TemplatesService,
  ) {
    this.credits = new CreditsService(store);
  }

  private async loadOwned(uid: string, id: string): Promise<Job> {
    const job = await this.store.get<Job>(`jobs/${id}`);
    if (!job || job.uid !== uid) throw notFound('Logbook not found.');
    return job;
  }

  private async characterBudget(job: Job): Promise<number> {
    if (job.mode === 'template' && job.templateId) {
      const template = await this.templates.get(job.templateId);
      const field =
        template?.unit.fields.find((f) => f.type === 'daily_activity' && f.dayIndex === 0) ??
        template?.unit.fields.find((f) => f.type === 'daily_activity');
      if (field && job.normalized) {
        const rotation = 0;
        const placement = placeRect(
          field.rect,
          job.normalized.pageWidthPt,
          job.normalized.pageHeightPt,
          rotation,
        );
        const chars = approximateCharsPerLine(field.fontSize.min, placement.width);
        const lines = maxLinesFor(placement.height, field.fontSize.min, 1.15);
        return Math.min(1200, Math.max(60, chars * lines));
      }
    }
    const lines = job.intake?.linesPerDay ?? 5;
    const chars = job.intake?.charsPerLine ?? 70;
    return Math.min(1500, Math.max(80, lines * chars));
  }

  private async buildWeekInput(
    job: Job,
    group: WeekGroup,
    budget: number,
    previousSummary?: string,
  ): Promise<WeekInput> {
    if (!job.intake) throw conflict('Answer the questions first.');
    return {
      weekNumber: group.weekNumber,
      programme: job.programme,
      department: job.department ?? job.programme,
      company: job.intake.company,
      unit: job.intake.unit,
      tasks: job.intake.tasks,
      tools: job.intake.tools,
      skills: job.intake.skills,
      dates: group.dates.map((date) => ({ date, dayName: weekdayName(date) })),
      detail: job.intake.detail,
      maxCharsPerEntry: budget,
      previousSummary,
      weeklyHighlights: job.intake.weeklyHighlights,
    };
  }

  private async generateWeekRecord(
    job: Job,
    group: WeekGroup,
    budget: number,
    previousSummary?: string,
  ): Promise<WeekRecord> {
    const input = await this.buildWeekInput(job, group, budget, previousSummary);
    const { output } = await generateValidatedWeek({
      provider: this.ai,
      input,
      studentName: job.studentDetails?.fullName,
      matricNo: job.studentDetails?.matricNo,
    });
    const entries = new Map(output.days.map((day) => [day.date, day]));
    const days: DayEntry[] = group.dates.map((date) => {
      const day = entries.get(date);
      return {
        date,
        dayName: weekdayName(date),
        entry: day?.entry ?? '',
        basedOn: day?.basedOn ?? [],
      };
    });
    return {
      weekNumber: group.weekNumber,
      startDate: group.startDate,
      endDate: group.endDate,
      workingDates: group.dates,
      days,
      weeklySummary: output.weeklySummary ?? '',
      status: 'done',
      regenCount: 0,
      updatedAt: new Date().toISOString(),
      flags: [],
    };
  }

  private async incrementRate(
    uid: string,
    field: 'previews' | 'uploads' | 'aiCalls',
    by = 1,
  ): Promise<number> {
    const id = rateDocId(uid);
    return this.store.transaction(async (tx) => {
      const current = (await tx.get<Record<string, number>>(`rate/${id}`)) ?? {};
      const next = { ...current, [field]: (current[field] ?? 0) + by, uid, day: id } as Record<
        string,
        number
      >;
      tx.set(`rate/${id}`, next);
      return next[field] ?? by;
    });
  }

  async preview(uid: string, id: string): Promise<{ job: Job; week: WeekRecord; removed: string[] }> {
    const job = await this.loadOwned(uid, id);
    if (!job.plan || !job.intake) throw conflict('Answer the questions first.');
    if (job.usage.previewsUsed >= LIMITS.previewsPerJob) {
      throw conflict('Your free preview for this logbook has been used.');
    }
    if (job.status !== 'ready_to_generate' && job.status !== 'generated' && job.status !== 'exported') {
      throw conflict('The preview is available after the questions.');
    }
    const usedToday = await this.incrementRate(uid, 'previews', 1);
    if (usedToday > LIMITS.previewsPerUserPerDay) {
      await this.incrementRate(uid, 'previews', -1);
      throw new ApiError(429, 'RATE_LIMITED', 'You can preview 3 logbooks per day.');
    }

    const group = job.plan.groups[0];
    if (!group) throw conflict('There are no working days to preview.');

    const existing = await this.store.get<WeekRecord>(`jobs/${id}/weeks/1`);
    let week = existing;
    let removed: string[] = [];
    if (!week) {
      const budget = await this.characterBudget(job);
      week = await this.generateWeekRecord(job, group, budget);
      week = { ...week, weeklySummary: week.weeklySummary };
      await this.store.set(`jobs/${id}/weeks/1`, week);
    }
    const next: Job = {
      ...job,
      usage: { ...job.usage, previewsUsed: job.usage.previewsUsed + 1, aiCalls: job.usage.aiCalls + 1 },
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await this.store.set(`jobs/${id}`, next);
    removed = redact(job.intake.tasks.map((task) => task.text).join(' '), {
      fullName: job.studentDetails?.fullName,
      matricNo: job.studentDetails?.matricNo,
    }).removed;
    return { job: next, week: week!, removed };
  }

  async start(uid: string, id: string, retry = false): Promise<{ job: Job; cost: number; balance: number }> {
    const job = await this.loadOwned(uid, id);
    if (!job.plan || !job.intake) throw conflict('Answer the questions first.');
    if (job.status === 'generating') throw conflict('This logbook is already being written.');
    if (job.status !== 'ready_to_generate' && job.status !== 'failed') {
      throw conflict('This logbook is not ready to generate.');
    }
    if (job.status === 'failed' && !retry) throw conflict('Retry the failed step first.');
    const cost = job.plan.cost;
    const attempt = retry ? (job.generationAttempt ?? 1) + 1 : (job.generationAttempt ?? 1);
    const balance = (await this.credits.balance(uid)).balance;
    if (balance < cost) throw insufficientCredits(cost, balance);
    await this.credits.reserve(uid, id, cost, attempt);
    const now = new Date().toISOString();
    const next: Job = {
      ...job,
      status: 'generating',
      generationAttempt: attempt,
      queue: { state: 'queued', kind: 'generate', attempts: 0 },
      error: undefined,
      updatedAt: now,
      lastActivityAt: now,
    };
    await this.store.set(`jobs/${id}`, next);
    return { job: next, cost, balance: balance - cost };
  }

  /** Worker entry point. Generates every missing week, then commits or releases credits. */
  async run(jobId: string): Promise<void> {
    const job = await this.store.get<Job>(`jobs/${jobId}`);
    if (!job) return;
    if (job.status !== 'generating' || !job.plan || !job.intake) return;
    const cost = job.plan.cost;
    const attempt = job.generationAttempt ?? 1;

    try {
      const existing = await this.store.query<WeekRecord>(`jobs/${jobId}/weeks`, {});
      const doneNumbers = new Set(existing.filter((week) => week.status === 'done').map((week) => week.weekNumber));
      const missing = job.plan.groups.filter((group) => !doneNumbers.has(group.weekNumber));
      const budget = await this.characterBudget(job);
      const pricing = await getPricing(this.store);
      const dailyCalls = await this.store.get<Record<string, number>>(`rate/${rateDocId(job.uid)}`);
      if ((dailyCalls?.aiCalls ?? 0) + missing.length > (pricing.limits.aiDailyCallsPerUser ?? LIMITS.aiDailyCallsPerUser)) {
        throw new ApiError(429, 'RATE_LIMITED', 'Daily writing limit reached. Try again tomorrow.');
      }

      let previousSummary = existing
        .sort((a, b) => a.weekNumber - b.weekNumber)
        .map((week) => week.weeklySummary)
        .filter(Boolean)
        .slice(-1)[0];

      const queue = [...missing];
      const runNext = async (): Promise<void> => {
        for (;;) {
          const group = queue.shift();
          if (!group) return;
          const week = await this.generateWeekRecord(job, group, budget, previousSummary);
          await this.store.set(`jobs/${jobId}/weeks/${week.weekNumber}`, week);
          previousSummary = week.weeklySummary || previousSummary;
          await this.store.merge(`jobs/${jobId}`, {
            usage: {
              ...job.usage,
              aiCalls: job.usage.aiCalls + 1,
            },
            updatedAt: new Date().toISOString(),
          });
        }
      };
      await Promise.all([runNext(), runNext()]);
      await this.incrementRate(job.uid, 'aiCalls', missing.length);

      await this.credits.commit(job.uid, jobId, cost, attempt);
      const fresh = await this.store.get<Job>(`jobs/${jobId}`);
      if (fresh) {
        await this.store.set(`jobs/${jobId}`, {
          ...fresh,
          status: 'generated',
          queue: { ...fresh.queue, state: 'idle', lockedAt: undefined },
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      await this.credits.release(job.uid, jobId, cost, attempt).catch(() => undefined);
      const fresh = await this.store.get<Job>(`jobs/${jobId}`);
      if (fresh) {
        await this.store.set(`jobs/${jobId}`, {
          ...fresh,
          status: 'failed',
          error: {
            code: error instanceof ApiError ? (error.code as 'AI_UNAVAILABLE') : 'AI_UNAVAILABLE',
            message: error instanceof Error ? error.message : 'Writing failed.',
            retryable: true,
          },
          queue: { ...fresh.queue, state: 'failed', lockedAt: undefined },
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async regenerateWeek(
    uid: string,
    id: string,
    weekNumber: number,
  ): Promise<{ week: WeekRecord; charged: number; balance: number }> {
    const job = await this.loadOwned(uid, id);
    if (!job.plan || !job.intake) throw conflict('Answer the questions first.');
    if (!['generated', 'exported'].includes(job.status)) {
      throw conflict('Generate the logbook before regenerating a week.');
    }
    const week = await this.store.get<WeekRecord>(`jobs/${id}/weeks/${weekNumber}`);
    if (!week) throw notFound('That week does not exist.');
    const pricing = await getPricing(this.store);
    const nextCount = (week.regenCount ?? 0) + 1;
    let charged = 0;
    let chargeId: string | null = null;
    if (nextCount > 2) {
      charged = pricing.regenCost;
      chargeId = regenLedgerId(id, weekNumber, nextCount);
      await this.credits.charge(uid, {
        id: chargeId,
        ref: id,
        amount: charged,
        type: 'regen',
        note: `Extra regeneration for week ${weekNumber}`,
      });
    }

    const group = job.plan.groups.find((entry) => entry.weekNumber === weekNumber);
    if (!group) throw notFound('That week is not in your plan.');
    const budget = await this.characterBudget(job);
    let regenerated: WeekRecord;
    try {
      regenerated = await this.generateWeekRecord(job, group, budget);
    } catch (error) {
      if (charged > 0 && chargeId) {
        await this.credits
          .refundCharge(uid, chargeId, charged, 'Regeneration failed — credits returned')
          .catch(() => undefined);
      }
      throw error;
    }
    const next: WeekRecord = {
      ...regenerated,
      regenCount: nextCount,
      days: regenerated.days.map((day) => ({ ...day, edited: false })),
    };
    await this.store.set(`jobs/${id}/weeks/${weekNumber}`, next);
    await this.store.merge(`jobs/${id}`, {
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });
    const { balance } = await this.credits.balance(uid);
    return { week: next, charged, balance };
  }

  async chat(
    uid: string,
    id: string,
    message: string,
  ): Promise<{ reply: string; charged: number; freeRemaining: number; removed: string[] }> {
    const job = await this.loadOwned(uid, id);
    if (!job.intake) throw conflict('Answer the questions first.');
    const pricing = await getPricing(this.store);
    const used = job.usage.chatMessages;
    const charged = used >= pricing.chatFreeMessages ? pricing.chatCost : 0;
    if (charged > 0) {
      await this.credits.charge(uid, {
        id: chatLedgerId(id, used + 1),
        ref: id,
        amount: charged,
        type: 'chat',
        note: 'Extra AI chat message',
      });
    }
    const weeks = await this.store.query<WeekRecord>(`jobs/${id}/weeks`, {});
    const recent = weeks
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .flatMap((week) => week.days.map((day) => day.entry))
      .filter(Boolean)
      .slice(-3);
    const redacted = redact(message, {
      fullName: job.studentDetails?.fullName,
      matricNo: job.studentDetails?.matricNo,
    });
    const reply = await this.ai.chat({
      context: {
        programme: job.programme,
        department: job.department ?? '',
        company: job.intake.company,
        unit: job.intake.unit,
        tasks: job.intake.tasks,
        tools: job.intake.tools,
        skills: job.intake.skills,
        recentEntries: recent,
        detail: job.intake.detail,
      },
      message: redacted.clean,
    });
    await this.store.merge(`jobs/${id}`, {
      usage: { ...job.usage, chatMessages: used + 1 },
      updatedAt: new Date().toISOString(),
    });
    return {
      reply,
      charged,
      freeRemaining: Math.max(0, pricing.chatFreeMessages - (used + 1)),
      removed: redacted.removed,
    };
  }

  /** Used by the export service to shorten overflowing text without inventing facts. */
  async shorten(text: string, maxChars: number): Promise<string> {
    return this.ai.shorten({ text, maxChars });
  }
}
