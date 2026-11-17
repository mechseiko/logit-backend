import { randomBytes } from 'node:crypto';
import {
  fingerprintSimilarity,
  pageSizeKey as makePageSizeKey,
  pageSizeMatches,
  templateInputSchema,
  validateTemplate,
  type JobAnalysis,
  type Programme,
  type Template,
  type TemplateInput,
} from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { badRequest, notFound } from '../errors.js';
import { differenceHash, loadPdf, pdfInfo, renderPages } from './pdf/index.js';
import { safeFileName, type StorageAdapter } from './storage/index.js';

export interface Candidate {
  templateId: string;
  score: number;
}

export class TemplatesService {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
  ) {}

  async get(id: string): Promise<Template | null> {
    return this.store.get<Template>(`templates/${id}`);
  }

  async requirePublished(id: string): Promise<Template> {
    const template = await this.get(id);
    if (!template || template.status !== 'published') throw notFound('Template not found.');
    return template;
  }

  async listPublished(): Promise<Template[]> {
    return this.store.query<Template>('templates', { where: [['status', '==', 'published']] });
  }

  async listAll(): Promise<Template[]> {
    const templates = await this.store.query<Template>('templates', {});
    return templates.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async candidates(programme: Programme, schoolId: string, analysis: JobAnalysis): Promise<Candidate[]> {
    const published = await this.listPublished();
    const jobSize = analysis.fingerprint.pageSizeKey;
    const scored: Candidate[] = [];
    for (const template of published) {
      if (!template.programmes.includes(programme)) continue;
      const schoolMatch = template.schoolIds.length === 0 || template.schoolIds.includes(schoolId);
      if (!schoolMatch) continue;
      if (!pageSizeMatches(template.pageSizeKey, jobSize)) continue;
      let score = 0.6;
      if (template.fingerprint.dhash.length > 0 && analysis.fingerprint.dhash.length > 0) {
        score = fingerprintSimilarity(template.fingerprint.dhash, analysis.fingerprint.dhash);
      }
      if (score >= 0.6) scored.push({ templateId: template.id, score: Math.round(score * 1000) / 1000 });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async create(input: unknown, adminUid: string): Promise<Template> {
    const parsed = this.parse(input);
    const id = `tpl_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const template: Template = {
      ...parsed,
      id,
      status: 'draft',
      version: 1,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.set(`templates/${id}`, template);
    return template;
  }

  async update(id: string, input: unknown): Promise<Template> {
    const existing = await this.get(id);
    if (!existing) throw notFound('Template not found.');
    const parsed = this.parse(input);
    const next: Template = {
      ...existing,
      ...parsed,
      id,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.store.set(`templates/${id}`, next);
    return next;
  }

  private parse(input: unknown): TemplateInput {
    const parsed = templateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw badRequest('The template is not valid yet.', parsed.error.flatten());
    }
    const candidate: Template = {
      ...parsed.data,
      id: 'validation',
      status: 'draft',
      version: 1,
    };
    const check = validateTemplate(candidate);
    if (!check.ok) throw badRequest('The template is not valid yet.', check.errors);
    return parsed.data;
  }

  async publish(id: string): Promise<Template> {
    const template = await this.get(id);
    if (!template) throw notFound('Template not found.');
    const check = validateTemplate(template);
    if (!check.ok) throw badRequest('Fix the template before publishing.', check.errors);
    const next: Template = {
      ...template,
      status: 'published',
      version: template.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.store.set(`templates/${id}`, next);
    return next;
  }

  async pageCount(template: Template): Promise<number> {
    return template.fingerprint.pageCount ?? template.unit.firstEntryPage + template.unit.maxUnits;
  }

  async pageUrl(templateId: string, page: number): Promise<{ url: string; pages: number }> {
    const template = await this.get(templateId);
    if (!template) throw notFound('Template not found.');
    const pages = await this.pageCount(template);
    if (page < 1 || page > pages) throw badRequest('That page does not exist.');
    const key = `templates/${templateId}/p${page}.png`;
    if (!(await this.storage.exists(key))) throw notFound('This template has no page image.');
    return { url: await this.storage.signedGetUrl(key, `template-${page}.png`), pages };
  }

  /** Admin uploads a blank logbook: store page images and geometry, then draw boxes in the editor. */
  async createFromUpload(
    input: { uploadKey: string; name: string; programmes: Programme[]; schoolIds: string[] },
    adminUid: string,
  ): Promise<Template> {
    const bytes = await this.storage.get(input.uploadKey);
    const pdf = await loadPdf(bytes);
    const info = pdfInfo(pdf);
    const rendered = await renderPages(
      bytes,
      info.pages,
      Math.min(110, 140),
      `${this.config.dataDir}/tmp`,
      this.config.pdfTools.pdftoppm,
    );
    const id = `tpl_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
    for (let i = 0; i < rendered.pages.length; i += 1) {
      await this.storage.put(`templates/${id}/p${i + 1}.png`, rendered.pages[i]!, 'image/png');
    }
    const hashes: string[] = [];
    for (const page of rendered.pages.slice(0, 3)) hashes.push(await differenceHash(page));
    const now = new Date().toISOString();
    const template: Template = {
      id,
      name: input.name,
      schoolIds: input.schoolIds,
      programmes: input.programmes,
      pageSizeKey: makePageSizeKey(info.width, info.height),
      fingerprint: { pageCount: info.pages, dhash: hashes },
      unit: {
        pagesPerUnit: 1,
        firstEntryPage: info.pages > 1 ? 1 : 0,
        maxUnits: Math.max(1, Math.min(info.pages - (info.pages > 1 ? 1 : 0), 26)),
        daysPerUnit: 5,
        fields: [],
      },
      staticFields: [],
      status: 'draft',
      version: 1,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.set(`templates/${id}`, template);
    return template;
  }
}

export { safeFileName };
