import {
  LIMITS,
  pageSizeKey as makePageSizeKey,
  type Job,
  type JobAnalysis,
  type JobError,
} from '@logit/shared';
import sharp from 'sharp';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { imagesToPdf, loadPdf, looksLikePdf, pdfInfo, extractEmbeddedText, compressPdf, differenceHash, renderPages } from './pdf/index.js';
import type { TemplatesService } from './templates.js';
import { activityPatch } from './retention.js';
import type { StorageAdapter } from './storage/index.js';

export interface IngestDeps {
  store: Store;
  storage: StorageAdapter;
  config: AppConfig;
  templates: TemplatesService;
}

export class IngestError extends Error {
  constructor(
    public readonly code: JobError['code'],
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

export class IngestService {
  constructor(private readonly deps: IngestDeps) {}

  private async readFile(key: string): Promise<Buffer> {
    try {
      return await this.deps.storage.get(key);
    } catch {
      throw new IngestError('PROCESSING_FAILED', 'We could not find your upload. Please upload again.', true);
    }
  }

  async process(jobId: string): Promise<void> {
    const { store, storage, config, templates } = this.deps;
    const job = await store.get<Job>(`jobs/${jobId}`);
    if (!job) throw new IngestError('NOT_FOUND', 'Job not found.');
    if (job.input.files.length === 0) {
      throw new IngestError('VALIDATION', 'No files were submitted for this job.');
    }

    let sourceBytes: Buffer;
    if (job.input.kind === 'pdf') {
      if (job.input.files.length !== 1) {
        throw new IngestError('VALIDATION', 'Upload one PDF for a PDF job.');
      }
      const file = job.input.files[0]!;
      if (file.size > LIMITS.maxPdfBytes) {
        throw new IngestError('TOO_LARGE', 'That PDF is larger than 10 MB. Compress it and try again.');
      }
      sourceBytes = await this.readFile(file.key);
      if (!looksLikePdf(sourceBytes)) {
        throw new IngestError('UNSUPPORTED_FILE', 'That file is not a real PDF. Export it as PDF and try again.');
      }
      const pdf = await loadPdf(sourceBytes);
      if (pdf.getPageCount() > LIMITS.maxPdfPages) {
        throw new IngestError(
          'TOO_MANY_PAGES',
          `That PDF has ${pdf.getPageCount()} pages. The limit is ${LIMITS.maxPdfPages}.`,
        );
      }
    } else {
      if (job.input.files.length > LIMITS.maxImages) {
        throw new IngestError('TOO_MANY_PAGES', `You can upload up to ${LIMITS.maxImages} photos.`);
      }
      const total = job.input.files.reduce((sum, file) => sum + file.size, 0);
      if (total > LIMITS.maxImagesTotalBytes) {
        throw new IngestError('TOO_LARGE', 'Those photos are over 30 MB in total. Remove a few and try again.');
      }
      const images = [];
      for (const file of job.input.files) {
        if (file.size > LIMITS.maxImageBytes) {
          throw new IngestError('TOO_LARGE', `${file.name} is larger than 8 MB.`);
        }
        const bytes = await this.readFile(file.key);
        try {
          await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
        } catch {
          throw new IngestError(
            'UNSUPPORTED_FILE',
            `${file.name} is not a real photo. Upload a JPG or PNG.`,
          );
        }
        images.push({ name: file.name, bytes });
      }
      sourceBytes = await imagesToPdf(images);
    }

    const compressed = await compressPdf(sourceBytes, {
      tmpDir: `${config.dataDir}/tmp`,
      gsBin: config.pdfTools.ghostscript,
      targetBytes: LIMITS.maxPdfOutputBytes,
    });
    if (compressed.bytes.byteLength > LIMITS.maxPdfHardBytes) {
      throw new IngestError('TOO_LARGE', 'That PDF is still over 10 MB after compression.');
    }

    const normalized = await loadPdf(compressed.bytes);
    const info = pdfInfo(normalized);
    if (info.pages === 0) throw new IngestError('PROCESSING_FAILED', 'That PDF has no pages.');
    // The 50-page limit applies to PDF uploads; photo jobs may legitimately compile up to 60 pages.
    if (job.input.kind === 'pdf' && info.pages > LIMITS.maxPdfPages) {
      throw new IngestError('TOO_MANY_PAGES', `That file has ${info.pages} pages; the limit is ${LIMITS.maxPdfPages}.`);
    }

    const normalizedKey = `normalized/${job.uid}/${job.id}/original.pdf`;
    await storage.put(normalizedKey, compressed.bytes, 'application/pdf');

    const rendered = await renderPages(
      compressed.bytes,
      info.pages,
      72,
      `${config.dataDir}/tmp`,
      config.pdfTools.pdftoppm,
    );
    const hashes: string[] = [];
    for (let index = 0; index < rendered.pages.length; index += 1) {
      const pageBuffer = rendered.pages[index]!;
      await storage.put(`thumbs/${job.uid}/${job.id}/p${index + 1}.png`, pageBuffer, 'image/png');
      if (index < 3) hashes.push(await differenceHash(pageBuffer));
    }

    const textPages = await extractEmbeddedText(normalized);
    const textPageNumbers = textPages.filter((page) => page.characters > 20).map((page) => page.page);
    const analysis: JobAnalysis = {
      textPages: textPageNumbers,
      hasEmbeddedText: textPageNumbers.length > 0,
      pageCount: info.pages,
      pageSizeKey: makePageSizeKey(info.width, info.height),
      fingerprint: {
        pageCount: info.pages,
        pageSizeKey: makePageSizeKey(info.width, info.height),
        dhash: hashes,
      },
      candidates: [],
      thumbnailKind: rendered.kind,
    };
    analysis.candidates = await templates.candidates(job.programme, job.schoolId, analysis);

    const now = new Date().toISOString();
    const next: Job = {
      ...job,
      status: analysis.candidates.length > 0 ? 'needs_layout_choice' : 'awaiting_template',
      normalized: {
        key: normalizedKey,
        bytes: compressed.bytes.byteLength,
        pages: info.pages,
        pageWidthPt: info.width,
        pageHeightPt: info.height,
      },
      analysis,
      queue: { ...job.queue, state: 'idle', lockedAt: undefined, attempts: job.queue.attempts },
      updatedAt: now,
      ...activityPatch(job, config.retentionDays, new Date(now)),
      error: undefined,
    };
    await store.set(`jobs/${job.id}`, next);

    // Raw uploads are no longer needed once the normalized copy exists.
    for (const file of job.input.files) {
      await storage.delete(file.key).catch(() => undefined);
    }
  }
}
