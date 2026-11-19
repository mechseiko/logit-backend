import type { Job } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { Logger } from '../logger.js';
import type { StorageAdapter } from './storage/index.js';

export interface CleanupResult {
  jobsDeleted: number;
  objectsDeleted: number;
  requestsDeleted: number;
  weeksDeleted: number;
  warning: boolean;
}

/** Hourly in-process retention worker (bucket lifecycle rules are the backup). */
export class CleanupService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.run().catch((error) => this.logger.error({ err: error }, 'cleanup failed'));
    }, this.config.cleanupIntervalMs);
    void this.run().catch((error) => this.logger.error({ err: error }, 'cleanup failed'));
    this.logger.info({ everyMs: this.config.cleanupIntervalMs }, 'cleanup started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(now: Date = new Date()): Promise<CleanupResult> {
    const nowIso = now.toISOString();
    const result: CleanupResult = {
      jobsDeleted: 0,
      objectsDeleted: 0,
      requestsDeleted: 0,
      weeksDeleted: 0,
      warning: false,
    };
    const jobs = await this.store.query<Job>('jobs', {});
    for (const job of jobs) {
      const inFlight =
        job.status === 'processing' ||
        job.status === 'generating' ||
        job.queue.state === 'running' ||
        job.queue.state === 'queued';
      if ((job.expiresAt <= nowIso || job.status === 'expired') && !inFlight) {
        await this.store.deleteTree(`jobs/${job.id}`);
        const removed = await Promise.all([
          this.storage.deletePrefix(`raw/${job.uid}/${job.id}`),
          this.storage.deletePrefix(`normalized/${job.uid}/${job.id}`),
          this.storage.deletePrefix(`thumbs/${job.uid}/${job.id}`),
          this.storage.deletePrefix(`outputs/${job.uid}/${job.id}`),
        ]);
        result.objectsDeleted += removed.reduce((sum, count) => sum + count, 0);
        result.jobsDeleted += 1;
        continue;
      }
      const lastActivity = new Date(job.lastActivityAt ?? job.updatedAt).getTime();
      const entriesAgeDays = (now.getTime() - lastActivity) / 86400000;
      if (entriesAgeDays > this.config.entriesRetentionDays) {
        const weeks = await this.store.query(`jobs/${job.id}/weeks`, {});
        for (const week of weeks) {
          const record = week as { weekNumber?: number };
          if (typeof record.weekNumber === 'number') {
            await this.store.delete(`jobs/${job.id}/weeks/${record.weekNumber}`);
            result.weeksDeleted += 1;
          }
        }
      }
      // Raw uploads that never became a job (draft abandoned before submit) and failed ingests.
      if (!job.normalized && !inFlight) {
        const rawAgeDays = (now.getTime() - new Date(job.createdAt).getTime()) / 86400000;
        if (rawAgeDays > 1) {
          result.objectsDeleted += await this.storage.deletePrefix(`raw/${job.uid}/${job.id}`);
        }
      }
    }

    const requests = await this.store.query<{
      id: string;
      pageImageKey: string;
      createdAt: string;
      status: string;
    }>('templateRequests', {});
    for (const request of requests) {
      const ageDays = (now.getTime() - new Date(request.createdAt).getTime()) / 86400000;
      if (request.status !== 'open' || ageDays > 30) {
        await this.storage.delete(request.pageImageKey).catch(() => undefined);
        await this.store.delete(`templateRequests/${request.id}`);
        result.requestsDeleted += 1;
      }
    }

    const rates = await this.store.query<{ day?: string; previews?: number }>('rate', {});
    const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    for (const rate of rates) {
      const docId = rate.day ?? '';
      const day = docId.split('_').pop();
      if (day && /^\d{8}$/.test(day) && day < cutoff) {
        await this.store.delete(`rate/${docId}`);
      }
    }

    const used = await this.storage.usedBytes('');
    const ratio = used / this.config.storageBudgetBytes;
    result.warning = ratio >= 0.7;
    await this.store.set('config/storage', {
      usedBytes: used,
      budgetBytes: this.config.storageBudgetBytes,
      ratio,
      warning: ratio >= 0.7,
      blocked: ratio >= 0.9,
      checkedAt: nowIso,
    });
    return result;
  }
}
