import type { IntakeAnswers, Job, JobOutput, StudentDetails, WeekRecord } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { conflict, notFound } from '../errors.js';
import { loadFontBytes } from './fonts.js';
import { buildLogbookDocument } from './pdf/logbookDoc.js';
import { ProfilesService } from './profiles.js';
import { activityPatch } from './retention.js';
import type { StorageAdapter } from './storage/index.js';

export interface ExportResult {
  version: number;
  url: string;
  kind: JobOutput['kind'];
  pages: number;
}

export class ExportService {
  private readonly profiles: ProfilesService;

  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
  ) {
    this.profiles = new ProfilesService(store);
  }

  private async loadOwned(uid: string, id: string): Promise<Job> {
    const job = await this.store.get<Job>(`jobs/${id}`);
    if (!job || job.uid !== uid) throw notFound('Logbook not found.');
    return job;
  }

  /**
   * Produces the document. There is one output shape now: a structured PDF written from the
   * student's own answers, never a copy of their scanned book with text dropped into it.
   */
  async exportJob(
    uid: string,
    id: string,
    options: { preview?: boolean; weeks?: WeekRecord[] } = {},
  ): Promise<ExportResult> {
    const job = await this.loadOwned(uid, id);
    if (!job.intake) throw conflict('Answer the questions first.');
    if (!options.preview && !['generated', 'exported'].includes(job.status)) {
      throw conflict('Write the entries before exporting.');
    }
    const weeks =
      options.weeks ??
      (await this.store.query<WeekRecord>(`jobs/${id}/weeks`, {})).sort(
        (a, b) => a.weekNumber - b.weekNumber,
      );
    if (weeks.length === 0) throw conflict('There are no entries to export yet.');

    const profile = await this.profiles.resolveFor(job.schoolId, job.programme);
    const fontBytes = await loadFontBytes();
    const { bytes, pages } = await buildLogbookDocument(
      {
        profile,
        weeks,
        intake: job.intake as IntakeAnswers,
        studentDetails: {
          // The cover falls back to what the profile already knows, so a student never sees a blank.
          school: job.schoolName,
          department: job.department,
          programme: job.programme,
          ...(job.studentDetails ?? {}),
        } as StudentDetails,
        title: job.title,
        programme: job.programme,
        watermark: Boolean(options.preview),
      },
      fontBytes,
    );

    const version = job.outputs.reduce((max, output) => Math.max(max, output.version), 0) + 1;
    const key = `outputs/${uid}/${id}/v${version}.pdf`;
    await this.storage.put(key, bytes, 'application/pdf');

    const output: JobOutput = {
      version,
      key,
      createdAt: new Date().toISOString(),
      kind: options.preview ? 'preview' : 'document',
    };
    const now = new Date().toISOString();
    const next: Job = {
      ...job,
      outputs: [...job.outputs, output],
      status: options.preview ? job.status : 'exported',
      updatedAt: now,
      ...activityPatch(job, this.config.retentionDays, new Date(now)),
    };
    await this.store.set(`jobs/${id}`, next);

    return {
      version,
      url: await this.storage.signedGetUrl(
        key,
        options.preview ? undefined : `logit-${job.id}-v${version}.pdf`,
        900,
      ),
      kind: output.kind,
      pages,
    };
  }

  async download(
    uid: string,
    id: string,
    version?: number,
  ): Promise<{ url: string; version: number; kind: JobOutput['kind'] }> {
    const job = await this.loadOwned(uid, id);
    if (job.outputs.length === 0) throw notFound('No export exists yet.');
    const output = version
      ? job.outputs.find((entry) => entry.version === version)
      : [...job.outputs].sort((a, b) => b.version - a.version)[0];
    if (!output) throw notFound('That export version does not exist.');
    return {
      url: await this.storage.signedGetUrl(output.key, `logit-${job.id}-v${output.version}.pdf`, 900),
      version: output.version,
      kind: output.kind,
    };
  }

  async configInfo(): Promise<{ supportEmail: string; supportWhatsapp: string; dpoContact: string }> {
    return {
      supportEmail: this.config.supportEmail,
      supportWhatsapp: this.config.supportWhatsapp,
      dpoContact: this.config.dpoContact,
    };
  }
}
