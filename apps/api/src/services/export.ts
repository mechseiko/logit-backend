import type { IntakeAnswers, Job, JobOutput, StudentDetails, Template, WeekRecord } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { conflict, notFound } from '../errors.js';
import { buildCopySheet } from './copysheet.js';
import { fillTemplate } from './fill.js';
import { loadFontBytes } from './fonts.js';
import type { StorageAdapter } from './storage/index.js';

export interface ExportResult {
  version: number;
  url: string;
  kind: JobOutput['kind'];
  pages: number;
  overflow: { week: number; field: string }[];
}

export class ExportService {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
    private readonly shorten: (text: string, maxChars: number) => Promise<string>,
  ) {}

  private async loadOwned(uid: string, id: string): Promise<Job> {
    const job = await this.store.get<Job>(`jobs/${id}`);
    if (!job || job.uid !== uid) throw notFound('Logbook not found.');
    return job;
  }

  async exportJob(
    uid: string,
    id: string,
    options: { preview?: boolean; weeks?: WeekRecord[] } = {},
  ): Promise<ExportResult> {
    const job = await this.loadOwned(uid, id);
    if (!job.normalized) throw conflict('This logbook is still being analysed.');
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

    const normalizedBytes = await this.storage.get(job.normalized.key);
    const fontBytes = await loadFontBytes();
    const template: Template | null = job.templateId
      ? await this.store.get<Template>(`templates/${job.templateId}`)
      : null;

    let bytes: Buffer;
    let pages: number;
    let overflow: { week: number; field: string }[] = [];
    let kind: JobOutput['kind'];

    if (job.mode === 'template' && template) {
      const result = await fillTemplate(
        normalizedBytes,
        {
          template,
          weeks,
          intake: job.intake as IntakeAnswers,
          studentDetails: (job.studentDetails ?? {}) as StudentDetails,
          programme: job.programme,
          watermark: Boolean(options.preview),
          shorten: this.shorten,
        },
        fontBytes,
      );
      bytes = result.bytes;
      pages = result.pages;
      overflow = result.overflow.map((entry) => ({ week: entry.week, field: entry.field }));
      kind = 'filled';
    } else {
      bytes = await buildCopySheet(
        {
          weeks,
          intake: job.intake as IntakeAnswers,
          title: job.title,
          programme: job.programme,
          watermark: Boolean(options.preview),
        },
        fontBytes,
      );
      pages = (await (await import('pdf-lib')).PDFDocument.load(bytes)).getPageCount();
      kind = 'copysheet';
    }
    if (options.preview) kind = 'preview';

    const version = job.outputs.reduce((max, output) => Math.max(max, output.version), 0) + 1;
    const key = `outputs/${uid}/${id}/v${version}.pdf`;
    await this.storage.put(key, bytes, 'application/pdf');

    const output: JobOutput = {
      version,
      key,
      createdAt: new Date().toISOString(),
      kind,
    };
    const now = new Date().toISOString();
    const next: Job = {
      ...job,
      outputs: [...job.outputs, output],
      status: options.preview ? job.status : 'exported',
      updatedAt: now,
      lastActivityAt: now,
    };
    await this.store.set(`jobs/${id}`, next);

    for (const item of overflow) {
      const week = weeks.find((entry) => entry.weekNumber === item.week);
      if (!week) continue;
      const flag = `overflow:${item.field}`;
      if (!week.flags.includes(flag)) {
        await this.store.merge(`jobs/${id}/weeks/${week.weekNumber}`, {
          flags: [...week.flags, flag],
        });
      }
    }

    return {
      version,
      // Previews open inline (a PDF viewer tab); final exports download.
      url: await this.storage.signedGetUrl(
        key,
        options.preview ? undefined : `logit-${job.id}-v${version}.pdf`,
        900,
      ),
      kind,
      pages,
      overflow,
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
      url: await this.storage.signedGetUrl(
        output.key,
        `logit-${job.id}-v${output.version}.pdf`,
        900,
      ),
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
