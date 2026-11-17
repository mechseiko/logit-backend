import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { Logger } from '../logger.js';
import type { Job, JobError } from '@logit/shared';
import type { GenerationService } from './generation.js';
import type { IngestService } from './ingest.js';

const RETRYABLE = new Set(['PROCESSING_FAILED', 'AI_UNAVAILABLE', 'INTERNAL']);
const KNOWN_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BANNED',
  'VALIDATION',
  'NOT_FOUND',
  'INSUFFICIENT_CREDITS',
  'RATE_LIMITED',
  'LIMIT_REACHED',
  'UNSUPPORTED_FILE',
  'ENCRYPTED_PDF',
  'TOO_LARGE',
  'TOO_MANY_PAGES',
  'PROCESSING_FAILED',
  'AI_UNAVAILABLE',
  'PAYMENT_ERROR',
  'CONFLICT',
  'INTERNAL',
]);

function toJobError(error: unknown): JobError {
  const maybe = error as { code?: string; message?: string };
  const code = maybe?.code && KNOWN_CODES.has(maybe.code) ? maybe.code : 'PROCESSING_FAILED';
  return {
    code,
    message: error instanceof Error ? error.message : 'Processing failed.',
    retryable: RETRYABLE.has(code),
  };
}

/** Persistent Firestore-backed queue. One job at a time by default (MAX_CONCURRENT_JOBS). */
export class QueueService {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;
  private current: Promise<void> | null = null;
  private currentJobId: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly ingest: IngestService,
    private readonly generation: GenerationService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.recover().catch((error) => this.logger.error({ err: error }, 'queue recovery failed'));
    this.timer = setInterval(() => void this.tick(), this.config.queuePollMs);
    this.logger.info({ pollMs: this.config.queuePollMs }, 'queue started');
  }

  /**
   * Stops claiming jobs, gives the current one `graceMs` to finish, and re-queues it
   * if the process is shutting down mid-flight so the next boot picks it up.
   */
  async stop(graceMs = 30_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const running = this.current;
    if (running) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, graceMs));
      await Promise.race([running.catch(() => undefined), timeout]);
    }

    const jobId = this.currentJobId;
    if (!jobId) return;
    try {
      const job = await this.store.get<Job>(`jobs/${jobId}`);
      if (job && job.queue.state === 'running') {
        await this.store.set(`jobs/${jobId}`, {
          ...job,
          status: job.queue.kind === 'generate' ? 'generating' : 'queued',
          queue: {
            ...job.queue,
            state: 'queued',
            attempts: (job.queue.attempts ?? 0) + 1,
            lockedAt: undefined,
            availableAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        });
        this.logger.warn({ jobId }, 're-queued job during shutdown');
      }
    } catch (error) {
      this.logger.error({ err: error, jobId }, 'could not re-queue job during shutdown');
    }
    this.currentJobId = null;
  }

  /** Re-queues jobs that were running when the process died. */
  async recover(): Promise<number> {
    const staleBefore = Date.now() - 10 * 60 * 1000;
    const jobs = await this.store.query<Job>('jobs', { where: [['queue.state', '==', 'running']] });
    let recovered = 0;
    for (const job of jobs) {
      const lockedAt = job.queue.lockedAt ? new Date(job.queue.lockedAt).getTime() : 0;
      if (lockedAt > staleBefore) continue;
      const attempts = (job.queue.attempts ?? 0) + 1;
      if (attempts > 3) {
        await this.store.set(`jobs/${job.id}`, {
          ...job,
          status: 'failed',
          queue: { ...job.queue, state: 'failed', lockedAt: undefined },
          error: {
            code: 'PROCESSING_FAILED',
            message: 'This job stopped responding and could not be recovered.',
            retryable: true,
          },
        });
      } else {
        await this.store.set(`jobs/${job.id}`, {
          ...job,
          status: job.queue.kind === 'generate' ? 'generating' : 'queued',
          queue: { ...job.queue, state: 'queued', lockedAt: undefined, attempts },
        });
      }
      recovered += 1;
    }
    return recovered;
  }

  private async claim(): Promise<Job | null> {
    const queued = await this.store.query<Job>('jobs', {
      where: [['queue.state', '==', 'queued']],
      orderBy: [['updatedAt', 'asc']],
      limit: 10,
    });
    const now = Date.now();
    for (const candidate of queued) {
      if (candidate.queue.availableAt && new Date(candidate.queue.availableAt).getTime() > now) continue;
      const claimed = await this.store.transaction(async (tx) => {
        const fresh = await tx.get<Job>(`jobs/${candidate.id}`);
        if (!fresh || fresh.queue.state !== 'queued') return null;
        const next: Job = {
          ...fresh,
          status: fresh.queue.kind === 'generate' ? 'generating' : 'processing',
          queue: { ...fresh.queue, state: 'running', lockedAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        };
        tx.set(`jobs/${fresh.id}`, next);
        return next;
      });
      if (claimed) return claimed;
    }
    return null;
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (let i = 0; i < this.config.maxConcurrentJobs; i += 1) {
        const job = await this.claim();
        if (!job) break;
        this.currentJobId = job.id;
        this.current = this.run(job);
        try {
          await this.current;
        } finally {
          this.current = null;
          this.currentJobId = null;
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, 'queue tick failed');
    } finally {
      this.ticking = false;
    }
  }

  private async run(job: Job): Promise<void> {
    const started = Date.now();
    try {
      if (job.queue.kind === 'generate') await this.generation.run(job.id);
      else await this.ingest.process(job.id);
      const fresh = await this.store.get<Job>(`jobs/${job.id}`);
      if (fresh && fresh.queue.state === 'running') {
        await this.store.set(`jobs/${job.id}`, {
          ...fresh,
          queue: { ...fresh.queue, state: 'idle', lockedAt: undefined },
        });
      }
      this.logger.info(
        { jobId: job.id, kind: job.queue.kind, ms: Date.now() - started },
        'queue job finished',
      );
    } catch (error) {
      const jobError = toJobError(error);
      const attempts = (job.queue.attempts ?? 0) + 1;
      const canRetry = jobError.retryable && attempts < 3 && job.queue.kind !== 'generate';
      const fresh = (await this.store.get<Job>(`jobs/${job.id}`)) ?? job;
      const next: Job = canRetry
        ? {
            ...fresh,
            status: 'queued',
            queue: {
              ...fresh.queue,
              state: 'queued',
              attempts,
              lockedAt: undefined,
              availableAt: new Date(Date.now() + 5000 * attempts).toISOString(),
            },
            error: jobError,
            updatedAt: new Date().toISOString(),
          }
        : {
            ...fresh,
            status: 'failed',
            queue: { ...fresh.queue, state: 'failed', attempts, lockedAt: undefined },
            error: jobError,
            updatedAt: new Date().toISOString(),
          };
      await this.store.set(`jobs/${job.id}`, next);
      this.logger.warn({ jobId: job.id, err: error, retry: canRetry }, 'queue job failed');
    }
  }
}
