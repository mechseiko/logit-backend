import { randomBytes } from 'node:crypto';
import {
  ACTIVE_JOB_STATUSES,
  LIMITS,
  computePlan,
  intakeSchema,
  presignSchema,
  type IntakeAnswers,
  type Job,
  type JobStatus,
  type FontFamily,
  type Plan,
  type Programme,
  type School,
  type StudentDetails,
  type TaskItem,
  type UserProfile,
  type WeekRecord,
} from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { badRequest, conflict, limitReached, notFound, rateLimited } from '../errors.js';
import { getPricing } from './pricing.js';
import { activityPatch, extendedExpiry } from './retention.js';
import { getSchool } from './schools.js';
import { ProfilesService } from './profiles.js';
import { proxyUploadUrl, safeFileName, type StorageAdapter } from './storage/index.js';

export interface PresignResult {
  jobId: string;
  uploads: { key: string; url: string; method: string; headers: Record<string, string> }[];
}

const IN_PROGRESS: JobStatus[] = ['queued', 'processing', 'generating'];

function jobId(): string {
  return `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export class JobsService {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
    private readonly profiles: ProfilesService,
  ) {}

  /** Cached bucket total for the soft budget guard; see guardStorage. */
  private storageTotal: { at: number; bytes: number } | null = null;

  private now(): string {
    return new Date().toISOString();
  }

  private async loadOwned(uid: string, id: string): Promise<Job> {
    const job = await this.store.get<Job>(`jobs/${id}`);
    if (!job || job.uid !== uid) throw notFound('Logbook not found.');
    return job;
  }

  private async activeJobs(uid: string): Promise<Job[]> {
    const jobs = await this.store.query<Job>('jobs', { where: [['uid', '==', uid]] });
    return jobs.filter(
      (job) =>
        ACTIVE_JOB_STATUSES.includes(job.status) &&
        job.status !== 'exported' &&
        job.status !== 'expired' &&
        new Date(job.expiresAt).getTime() > Date.now(),
    );
  }

  private async uploadsToday(uid: string): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const jobs = await this.store.query<Job>('jobs', {
      where: [
        ['uid', '==', uid],
        ['createdAt', '>=', start.toISOString()],
      ],
    });
    return jobs.length;
  }

  /**
   * A soft budget guard. Accounting the whole bucket is a listing that can be slow or fail on a
   * provider hiccup, and it used to run on every upload — a failed listing turned into a bare 500 and
   * blocked the student. It is now cached for a few minutes, and if the listing fails the upload is
   * allowed: the real limits are the per-user caps, and the provider itself rejects a full bucket.
   */
  private async guardStorage(): Promise<void> {
    const now = Date.now();
    if (!this.storageTotal || now - this.storageTotal.at > 5 * 60_000) {
      try {
        this.storageTotal = { at: now, bytes: await this.storage.usedBytes('') };
      } catch {
        this.storageTotal = { at: now, bytes: 0 };
        return;
      }
    }
    const used = this.storageTotal.bytes;
    const ratio = used / this.config.storageBudgetBytes;
    if (ratio >= 0.9) {
      throw rateLimited('Storage is full right now. Please try again later.');
    }
    if (ratio >= 0.7) {
      await this.store
        .merge('config/flags', { storageWarning: true, storageUsedBytes: used })
        .catch(() => undefined);
    }
  }

  async presign(uid: string, profile: UserProfile, body: unknown): Promise<PresignResult> {
    const parsed = presignSchema.safeParse(body);
    if (!parsed.success) throw badRequest('Check the files you selected.', parsed.error.flatten());
    const input = parsed.data;

    if (input.kind === 'pdf') {
      if (input.files.length !== 1) throw badRequest('Upload exactly one PDF.');
      const file = input.files[0]!;
      if (file.size > LIMITS.maxPdfBytes) throw badRequest('PDFs must be 20 MB or smaller.');
    } else {
      if (input.files.length > LIMITS.maxImages) {
        throw badRequest(`You can upload up to ${LIMITS.maxImages} photos.`);
      }
      const total = input.files.reduce((sum, file) => sum + file.size, 0);
      if (total > LIMITS.maxImagesTotalBytes) throw badRequest('Photos must total 30 MB or less.');
      for (const file of input.files) {
        if (file.size > LIMITS.maxImageBytes) throw badRequest(`${file.name} is larger than 8 MB.`);
      }
    }

    await this.guardStorage();
    if ((await this.activeJobs(uid)).length >= LIMITS.maxActiveJobs) {
      throw limitReached(`You can keep ${LIMITS.maxActiveJobs} logbooks at a time. Finish or delete one first.`);
    }
    if ((await this.uploadsToday(uid)) >= LIMITS.uploadsPerDay) {
      throw rateLimited('You have uploaded 5 logbooks today. Try again tomorrow.');
    }

    const id = jobId();
    const now = this.now();
    const files = input.files.map((file, index) => ({
      key: `raw/${uid}/${id}/${index + 1}-${safeFileName(file.name, input.kind === 'pdf' ? 'logbook.pdf' : 'page.jpg')}`,
      name: file.name,
      size: file.size,
      type: file.type,
    }));
    const title = input.files[0]?.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'My logbook';
    const resolved = await this.profiles.resolveFor(profile.schoolId, profile.programme ?? 'SIWES');
    const job: Job = {
      id,
      uid,
      status: 'created',
      title,
      programme: profile.programme ?? 'SIWES',
      schoolId: profile.schoolId ?? '',
      schoolName: profile.schoolName,
      department: profile.department,
      input: { kind: input.kind, files },
      profileId: resolved.id,
      usage: { previewsUsed: 0, chatMessages: 0, aiCalls: 0 },
      outputs: [],
      queue: { state: 'idle', attempts: 0 },
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: extendedExpiry({ createdAt: now }, this.config.retentionDays, new Date(now)),
    };
    await this.store.set(`jobs/${id}`, job);

    const maxBytes = input.kind === 'pdf' ? LIMITS.maxPdfBytes : LIMITS.maxImageBytes;
    const uploads = await Promise.all(
      files.map(async (file) => {
        const signed = proxyUploadUrl(this.config.apiPublicUrl, this.config.devAuthSecret, {
          key: file.key,
          mime: file.type,
          maxBytes,
        });
        return { key: file.key, url: signed.url, method: signed.method, headers: signed.headers };
      }),
    );
    return { jobId: id, uploads };
  }

  async submit(uid: string, id: string, body: unknown): Promise<Job> {
    const job = await this.loadOwned(uid, id);
    if (job.status !== 'created') throw conflict('This logbook was already submitted.');
    const orderedKeys = (body as { orderedKeys?: unknown })?.orderedKeys;
    if (!Array.isArray(orderedKeys) || orderedKeys.length === 0) throw badRequest('Submit at least one file.');
    const known = new Set(job.input.files.map((file) => file.key));
    if (!orderedKeys.every((key) => typeof key === 'string' && known.has(key))) {
      throw badRequest('Some uploaded files are missing.');
    }
    if (job.input.kind === 'pdf' && orderedKeys.length !== 1) throw badRequest('Upload one PDF only.');
    for (const key of orderedKeys) {
      if (!(await this.storage.exists(key))) throw badRequest('An upload did not finish. Please try again.');
    }

    const jobs = await this.store.query<Job>('jobs', { where: [['uid', '==', uid]] });
    if (jobs.some((other) => other.id !== id && IN_PROGRESS.includes(other.status))) {
      throw conflict('Your previous upload is still being processed. Wait for it to finish.');
    }

    const orderedFiles = orderedKeys.map((key) => job.input.files.find((file) => file.key === key)!);
    const now = this.now();
    const next: Job = {
      ...job,
      input: { ...job.input, files: orderedFiles },
      status: 'queued',
      queue: { state: 'queued', kind: 'ingest', attempts: 0 },
      updatedAt: now,
      ...activityPatch(job, this.config.retentionDays, new Date(now)),
    };
    await this.store.set(`jobs/${id}`, next);
    return next;
  }

  async list(uid: string): Promise<Job[]> {
    return this.store.query<Job>('jobs', {
      where: [['uid', '==', uid]],
      orderBy: [['createdAt', 'desc']],
      limit: 50,
    });
  }

  async get(uid: string, id: string): Promise<Job> {
    const job = await this.loadOwned(uid, id);
    return job;
  }

  async remove(uid: string, id: string): Promise<void> {
    const job = await this.loadOwned(uid, id);
    // Deleting mid-generation would strand the credits reserved for the run.
    if (job.status === 'generating' || (job.queue.kind === 'generate' && job.queue.state !== 'idle')) {
      throw conflict('Wait for this logbook to finish generating, then delete it.');
    }
    await this.store.deleteTree(`jobs/${id}`);
    await Promise.all([
      this.storage.deletePrefix(`raw/${uid}/${id}`),
      this.storage.deletePrefix(`normalized/${uid}/${id}`),
      this.storage.deletePrefix(`thumbs/${uid}/${id}`),
      this.storage.deletePrefix(`outputs/${uid}/${id}`),
      this.storage.deletePrefix(`template-requests/${uid}/${id}`),
    ]);
    void job;
  }

  async retry(uid: string, id: string): Promise<Job> {
    const job = await this.loadOwned(uid, id);
    if (job.status !== 'failed') throw conflict('Only failed logbooks can be retried.');
    const now = this.now();
    if (!job.normalized) {
      const next: Job = {
        ...job,
        status: 'queued',
        queue: { state: 'queued', kind: 'ingest', attempts: 0 },
        error: undefined,
        updatedAt: now,
        ...activityPatch(job, this.config.retentionDays, new Date(now)),
      };
      await this.store.set(`jobs/${id}`, next);
      return next;
    }
    // A retry is a new generation attempt: fresh reserve/commit/release ledger ids, so the
    // credits reserved by the failed attempt can be released and charged again cleanly.
    const next: Job = {
      ...job,
      status: 'ready_to_generate',
      error: undefined,
      generationAttempt: (job.generationAttempt ?? 1) + 1,
      updatedAt: now,
      ...activityPatch(job, this.config.retentionDays, new Date(now)),
    };
    await this.store.set(`jobs/${id}`, next);
    return next;
  }

  async thumbUrl(uid: string, id: string, page: number): Promise<{ url: string }> {
    const job = await this.loadOwned(uid, id);
    if (!job.normalized) throw conflict('This logbook is still being analysed.');
    if (page < 1 || page > job.normalized.pages) throw badRequest('That page does not exist.');
    const key = `thumbs/${uid}/${id}/p${page}.png`;
    if (!(await this.storage.exists(key))) throw notFound('That page image is not ready yet.');
    return { url: await this.storage.signedGetUrl(key, `page-${page}.png`) };
  }

  async saveIntake(
    uid: string,
    id: string,
    body: { intake: unknown; studentDetails?: Record<string, string> },
  ): Promise<{ job: Job; plan: Plan }> {
    const job = await this.loadOwned(uid, id);
    if (job.status === 'generating' || job.status === 'queued' || job.status === 'processing') {
      throw conflict('Wait for the current step to finish.');
    }
    const parsed = intakeSchema.safeParse(body.intake);
    if (!parsed.success) throw badRequest('Check your answers.', parsed.error.flatten());

    const tasks: TaskItem[] = parsed.data.tasks.map((task, index) => ({
      id: `T${index + 1}`,
      text: task.text,
    }));
    const intake: IntakeAnswers = { ...parsed.data, tasks };
    const profile = await this.profiles.require(job.profileId);
    const pricing = await getPricing(this.store);
    const plan = computePlan(
      {
        startDate: intake.startDate,
        endDate: intake.endDate,
        workingDays: intake.workingDays,
        holidays: intake.holidays,
        extraDaysOff: intake.extraDaysOff,
        maxUnits: profile.weeks,
      },
      pricing,
    );
    if (plan.weeks === 0) throw badRequest('No working days were found. Check your dates and days off.');

    let studentDetails: StudentDetails | undefined;
    if (body.studentDetails && typeof body.studentDetails === 'object') {
      const allowed = ['fullName', 'matricNo', 'department', 'level', 'school', 'company', 'unit', 'programme'];
      studentDetails = {};
      for (const [key, value] of Object.entries(body.studentDetails)) {
        if (!allowed.includes(key) || typeof value !== 'string') continue;
        studentDetails[key as keyof StudentDetails] = value.trim().slice(0, 200);
      }
    }

    const now = this.now();
    const next: Job = {
      ...job,
      intake,
      studentDetails,
      plan,
      status: 'ready_to_generate',
      updatedAt: now,
      ...activityPatch(job, this.config.retentionDays, new Date(now)),
    };
    await this.store.set(`jobs/${id}`, next);
    return { job: next, plan };
  }

  /** The typeface the document will be set in. Changeable until the first export. */
  async setFont(uid: string, id: string, fontFamily: FontFamily): Promise<Job> {
    const job = await this.loadOwned(uid, id);
    if (job.status === 'generating' || job.status === 'queued' || job.status === 'processing') {
      throw conflict('Wait for the current step to finish.');
    }
    const next: Job = { ...job, fontFamily, updatedAt: this.now() };
    await this.store.set(`jobs/${id}`, next);
    return next;
  }

  async weeks(uid: string, id: string): Promise<WeekRecord[]> {
    await this.loadOwned(uid, id);
    const weeks = await this.store.query<WeekRecord>(`jobs/${id}/weeks`, {});
    return weeks.sort((a, b) => a.weekNumber - b.weekNumber);
  }

  async updateWeek(
    uid: string,
    id: string,
    weekNumber: number,
    body: { days: { date: string; entry: string }[]; weeklySummary?: string },
  ): Promise<WeekRecord> {
    const job = await this.loadOwned(uid, id);
    if (!['generated', 'exported', 'ready_to_generate'].includes(job.status)) {
      throw conflict('Entries can be edited after they are written.');
    }
    const week = await this.store.get<WeekRecord>(`jobs/${id}/weeks/${weekNumber}`);
    if (!week) throw notFound('That week does not exist.');
    const byDate = new Map(week.days.map((day) => [day.date, day]));
    for (const update of body.days) {
      const day = byDate.get(update.date);
      if (!day) throw badRequest(`${update.date} is not part of week ${weekNumber}.`);
      day.entry = update.entry;
      day.edited = true;
    }
    const next: WeekRecord = {
      ...week,
      days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      weeklySummary: body.weeklySummary ?? week.weeklySummary,
      updatedAt: this.now(),
    };
    await this.store.set(`jobs/${id}/weeks/${weekNumber}`, next);
    await this.store.merge(`jobs/${id}`, {
      updatedAt: this.now(),
      ...activityPatch(job, this.config.retentionDays),
    });
    return next;
  }

  /** What the intake form needs to collect, from the profile the job was created against. */
  async intakeHints(uid: string, id: string): Promise<{
    profileId: string;
    profileName: string;
    daysPerWeek: number;
    weeks: number;
    needsStudentDetails: { key: string; label: string }[];
    needsWeeklySummary: boolean;
  }> {
    const job = await this.loadOwned(uid, id);
    const profile = await this.profiles.require(job.profileId);
    const labels: Record<string, string> = {
      fullName: 'Full name',
      matricNo: 'Matric number',
      department: 'Department',
      level: 'Level',
      school: 'School',
      company: 'Company',
      unit: 'Unit',
      programme: 'Programme',
    };
    return {
      profileId: profile.id,
      profileName: profile.name,
      daysPerWeek: profile.daysPerWeek,
      weeks: profile.weeks,
      needsStudentDetails: ['fullName', 'matricNo', 'department', 'level', 'school'].map((key) => ({
        key,
        label: labels[key] ?? key,
      })),
      needsWeeklySummary: true,
    };
  }

  async school(uid: string, profile: UserProfile): Promise<School | null> {
    if (!profile.schoolId) return null;
    return getSchool(this.store, profile.schoolId);
  }

  async programme(profile: UserProfile): Promise<Programme> {
    return profile.programme ?? 'SIWES';
  }
}
