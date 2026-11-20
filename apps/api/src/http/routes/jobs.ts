import express, { Router } from 'express';
import { z } from 'zod';
import {
  chatSchema,
  modeSchema,
  reportGenerateSchema,
  requestTemplateSchema,
  selectTemplateSchema,
  submitSchema,
  weekUpdateSchema,
  LIMITS,
} from '@logit/shared';
import type { AppConfig } from '../../config.js';
import { requireProfile } from '../context.js';
import { asyncHandler, parseBody } from '../middleware.js';
import { badRequest } from '../../errors.js';
import type { Services } from '../../services/index.js';
import { signedTemplatePreview } from './helpers.js';
import { compressPdf } from '../../services/pdf/compress.js';

export function createJobsRouter(services: Services, config: AppConfig): Router {
  const router = Router();

  /**
   * Compress a PDF before it is uploaded anywhere. The browser posts the raw bytes (no multipart),
   * we run the same Ghostscript pass the ingest pipeline uses, and the response is the smaller file.
   */
  router.post(
    '/uploads/compress',
    express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '24mb' }),
    asyncHandler(async (req, res) => {
      requireProfile(req);
      const body = req.body as Buffer;
      if (!body || body.length === 0) throw badRequest('Send the PDF as the request body.');
      if (body.length > LIMITS.maxPdfBytes) {
        throw badRequest(`PDFs must be 20 MB or smaller. This one is ${(body.length / 1024 / 1024).toFixed(1)} MB.`);
      }
      if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('That file is not a PDF.');
      const result = await compressPdf(body, {
        tmpDir: `${config.dataDir}/tmp`,
        gsBin: config.pdfTools.ghostscript,
        targetBytes: LIMITS.maxPdfOutputBytes,
      });
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('x-logit-compression', result.method);
      res.setHeader('x-logit-original-bytes', String(body.length));
      res.send(result.bytes);
    }),
  );

  router.post(
    '/uploads/presign',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const result = await services.jobs.presign(profile.uid, profile, req.body);
      res.json(result);
    }),
  );

  router.post(
    '/jobs/:id/submit',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(submitSchema, req.body);
      const job = await services.jobs.submit(profile.uid, req.params.id!, body);
      res.json({ job });
    }),
  );

  router.get(
    '/jobs',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const jobs = await services.jobs.list(profile.uid);
      res.json({ jobs });
    }),
  );

  router.get(
    '/jobs/:id',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const job = await services.jobs.get(profile.uid, req.params.id!);
      const template = job.templateId ? await services.templates.get(job.templateId) : null;
      const weeks = await services.jobs.weeks(profile.uid, req.params.id!);
      res.json({
        job,
        template: template
          ? {
              id: template.id,
              name: template.name,
              pageCount: template.fingerprint.pageCount ?? 1,
              pagesPerUnit: template.unit.pagesPerUnit,
              hasWeeklySummary: template.unit.fields.some(
                (field) => field.type === 'weekly_summary',
              ),
            }
          : null,
        weeks,
        limits: { retentionDays: config.retentionDays },
      });
    }),
  );

  router.delete(
    '/jobs/:id',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      await services.jobs.remove(profile.uid, req.params.id!);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/jobs/:id/retry',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const job = await services.jobs.retry(profile.uid, req.params.id!);
      res.json({ job });
    }),
  );

  router.get(
    '/jobs/:id/thumb/:page',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const page = Math.max(1, Number.parseInt(req.params.page!, 10) || 1);
      const result = await services.jobs.thumbUrl(profile.uid, req.params.id!, page);
      res.json(result);
    }),
  );

  router.get(
    '/jobs/:id/candidates',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const job = await services.jobs.get(profile.uid, req.params.id!);
      const candidates = job.analysis?.candidates ?? [];
      const enriched = [];
      for (const candidate of candidates) {
        const template = await services.templates.get(candidate.templateId);
        if (!template) continue;
        enriched.push({
          templateId: template.id,
          name: template.name,
          score: candidate.score,
          pageUrl: await signedTemplatePreview(services, template.id),
        });
      }
      const pageUrl = job.normalized
        ? await services.jobs.thumbUrl(profile.uid, job.id, 1).then((r) => r.url)
        : '';
      res.json({ candidates: enriched, pageUrl });
    }),
  );

  router.post(
    '/jobs/:id/select-template',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(selectTemplateSchema, req.body);
      const job = await services.jobs.selectTemplate(profile.uid, req.params.id!, body.templateId);
      res.json({ job });
    }),
  );

  router.post(
    '/jobs/:id/request-template',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      parseBody(requestTemplateSchema, req.body);
      const job = await services.jobs.requestTemplate(profile.uid, req.params.id!);
      res.json({ job });
    }),
  );

  router.post(
    '/jobs/:id/mode',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      parseBody(modeSchema, req.body);
      const job = await services.jobs.useCopySheet(profile.uid, req.params.id!);
      res.json({ job });
    }),
  );

  router.get(
    '/jobs/:id/intake-hints',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const hints = await services.jobs.intakeHints(profile.uid, req.params.id!);
      res.json(hints);
    }),
  );

  router.put(
    '/jobs/:id/intake',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = req.body as { intake?: unknown; studentDetails?: Record<string, string> };
      const result = await services.jobs.saveIntake(profile.uid, req.params.id!, {
        intake: body?.intake,
        studentDetails: body?.studentDetails,
      });
      res.json({
        job: result.job,
        plan: result.plan,
        weeks: result.plan.weeks,
        cost: result.plan.cost,
        sizeTier: result.plan.sizeTier,
        warnings: result.plan.warnings,
      });
    }),
  );

  router.post(
    '/jobs/:id/preview',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const preview = await services.generation.preview(profile.uid, req.params.id!);
      const output = await services.export.exportJob(profile.uid, req.params.id!, {
        preview: true,
        weeks: [preview.week],
      });
      res.json({
        url: output.url,
        version: output.version,
        week: preview.week,
        removed: preview.removed,
      });
    }),
  );

  router.post(
    '/jobs/:id/generate',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const result = await services.generation.start(profile.uid, req.params.id!);
      res.json({ job: result.job, cost: result.cost, balance: result.balance });
    }),
  );

  router.get(
    '/jobs/:id/weeks',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const weeks = await services.jobs.weeks(profile.uid, req.params.id!);
      res.json({ weeks });
    }),
  );

  router.put(
    '/jobs/:id/weeks/:n',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const weekNumber = Number.parseInt(req.params.n!, 10);
      const body = parseBody(weekUpdateSchema, req.body);
      const week = await services.jobs.updateWeek(profile.uid, req.params.id!, weekNumber, body);
      res.json({ week });
    }),
  );

  router.post(
    '/jobs/:id/weeks/:n/regenerate',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const weekNumber = Number.parseInt(req.params.n!, 10);
      const result = await services.generation.regenerateWeek(
        profile.uid,
        req.params.id!,
        weekNumber,
      );
      res.json(result);
    }),
  );

  router.post(
    '/jobs/:id/chat',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(chatSchema, req.body);
      const result = await services.generation.chat(profile.uid, req.params.id!, body.message);
      res.json(result);
    }),
  );

  router.post(
    '/jobs/:id/export',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const result = await services.export.exportJob(profile.uid, req.params.id!);
      res.json(result);
    }),
  );

  router.get(
    '/jobs/:id/download',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const version = req.query.version ? Number.parseInt(String(req.query.version), 10) : undefined;
      const result = await services.export.download(profile.uid, req.params.id!, version);
      res.json(result);
    }),
  );

  router.post(
    '/jobs/:id/report',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(z.object({ message: z.string().trim().min(3).max(1000) }), req.body);
      await services.admin.recordReport(profile.uid, req.params.id!, body.message);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/reports/generate',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(reportGenerateSchema, req.body);
      const result = await services.reports.generate(profile.uid, { ...body, tools: body.tools ?? '' });
      res.json(result);
    }),
  );

  return router;
}
