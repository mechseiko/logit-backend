import { Router } from 'express';
import { z } from 'zod';
import {
  adminAdjustSchema,
  adminBanSchema,
  resolveTemplateRequestSchema,
  schoolUpsertSchema,
  templateInputSchema,
  type Programme,
} from '@logit/shared';
import type { AppConfig } from '../../config.js';
import { requireAuthUser } from '../context.js';
import { asyncHandler, parseBody } from '../middleware.js';
import type { Services } from '../../services/index.js';
import type { StorageAdapter } from '../../services/storage/index.js';
import { getPricing, setPricing } from '../../services/pricing.js';
import { createOrUpdateSchool, listSchools } from '../../services/schools.js';
import { proxyUploadUrl, safeFileName } from '../../services/storage/index.js';
import type { Store } from '../../db/index.js';

const fromUploadSchema = z.object({
  uploadKey: z.string().min(3),
  name: z.string().trim().min(2).max(120),
  programmes: z.array(z.enum(['SIWES', 'SWEP', 'IT'])).min(1),
  schoolIds: z.array(z.string()).max(100).default([]),
});

export function createAdminRouter(
  services: Services,
  store: Store,
  storage: StorageAdapter,
  config: AppConfig,
): Router {
  const router = Router();
  const adminUid = (req: Parameters<typeof requireAuthUser>[0]) => requireAuthUser(req).uid;

  router.get(
    '/stats',
    asyncHandler(async (_req, res) => {
      res.json(await services.admin.stats());
    }),
  );

  router.get(
    '/users',
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json({ users: await services.admin.users(q) });
    }),
  );

  router.get(
    '/users/:uid',
    asyncHandler(async (req, res) => {
      res.json(await services.admin.user(req.params.uid!));
    }),
  );

  router.post(
    '/users/:uid/adjust',
    asyncHandler(async (req, res) => {
      const body = parseBody(adminAdjustSchema, req.body);
      const user = await services.admin.adjust(req.params.uid!, body.amount, body.reason, adminUid(req));
      res.json({ user });
    }),
  );

  router.post(
    '/users/:uid/ban',
    asyncHandler(async (req, res) => {
      const body = parseBody(adminBanSchema, req.body);
      const user = await services.admin.setBanned(
        req.params.uid!,
        body.banned,
        body.reason,
        adminUid(req),
      );
      res.json({ user });
    }),
  );

  router.get(
    '/payments',
    asyncHandler(async (_req, res) => {
      res.json({ payments: await services.admin.listPayments() });
    }),
  );

  router.post(
    '/payments/:reference/reconcile',
    asyncHandler(async (req, res) => {
      res.json(await services.admin.reconcile(req.params.reference!, adminUid(req)));
    }),
  );

  router.get(
    '/jobs',
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      res.json({ jobs: await services.admin.listJobs(status) });
    }),
  );

  router.post(
    '/jobs/:id/retry',
    asyncHandler(async (req, res) => {
      const job = await services.admin.retryJob(req.params.id!, adminUid(req));
      res.json({ job });
    }),
  );

  router.get(
    '/templates',
    asyncHandler(async (_req, res) => {
      res.json({ templates: await services.templates.listAll() });
    }),
  );

  router.post(
    '/templates',
    asyncHandler(async (req, res) => {
      const body = parseBody(templateInputSchema, req.body);
      const template = await services.templates.create(body, adminUid(req));
      await services.admin.log(adminUid(req), 'template.create', template.id);
      res.json({ template });
    }),
  );

  router.put(
    '/templates/:id',
    asyncHandler(async (req, res) => {
      const body = parseBody(templateInputSchema, req.body);
      const template = await services.templates.update(req.params.id!, body);
      await services.admin.log(adminUid(req), 'template.update', template.id);
      res.json({ template });
    }),
  );

  router.post(
    '/templates/:id/publish',
    asyncHandler(async (req, res) => {
      const template = await services.templates.publish(req.params.id!);
      await services.admin.log(adminUid(req), 'template.publish', template.id);
      res.json({ template });
    }),
  );

  router.get(
    '/templates/:id/pages/:page',
    asyncHandler(async (req, res) => {
      const page = Math.max(1, Number.parseInt(req.params.page!, 10) || 1);
      res.json(await services.templates.pageUrl(req.params.id!, page));
    }),
  );

  router.post(
    '/templates/from-upload',
    asyncHandler(async (req, res) => {
      const body = parseBody(fromUploadSchema, req.body);
      const template = await services.templates.createFromUpload(
        {
          uploadKey: body.uploadKey,
          name: body.name,
          programmes: body.programmes as Programme[],
          schoolIds: body.schoolIds ?? [],
        },
        adminUid(req),
      );
      await services.admin.log(adminUid(req), 'template.fromUpload', template.id);
      res.json({ template });
    }),
  );

  router.post(
    '/uploads/presign',
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(200),
          type: z.string().min(1).max(100),
          size: z.number().int().min(1).max(10 * 1024 * 1024),
        }),
        req.body,
      );
      const key = `template-uploads/${adminUid(req)}/${Date.now().toString(36)}-${safeFileName(body.name, 'template.pdf')}`;
      const signed = proxyUploadUrl(config.apiPublicUrl, config.devAuthSecret, {
        key,
        mime: 'application/pdf',
        maxBytes: 10 * 1024 * 1024,
      });
      res.json({ key, url: signed.url, method: signed.method, headers: signed.headers });
    }),
  );

  router.get(
    '/template-requests',
    asyncHandler(async (_req, res) => {
      res.json({ requests: await services.admin.templateRequests() });
    }),
  );

  router.post(
    '/template-requests/:id/resolve',
    asyncHandler(async (req, res) => {
      const body = parseBody(resolveTemplateRequestSchema, req.body);
      await services.admin.resolveTemplateRequest(req.params.id!, body, adminUid(req));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/schools',
    asyncHandler(async (_req, res) => {
      res.json({ schools: await listSchools(store) });
    }),
  );

  router.post(
    '/schools',
    asyncHandler(async (req, res) => {
      const body = parseBody(schoolUpsertSchema, req.body);
      const school = await createOrUpdateSchool(store, {
        ...body,
        aliases: body.aliases ?? [],
        active: body.active ?? true,
      });
      await services.admin.log(adminUid(req), 'school.create', school.id);
      res.json({ school });
    }),
  );

  router.put(
    '/schools/:id',
    asyncHandler(async (req, res) => {
      const body = parseBody(schoolUpsertSchema, req.body);
      const school = await createOrUpdateSchool(
        store,
        { ...body, aliases: body.aliases ?? [], active: body.active ?? true },
        req.params.id!,
      );
      await services.admin.log(adminUid(req), 'school.update', school.id);
      res.json({ school });
    }),
  );

  router.get(
    '/school-requests',
    asyncHandler(async (_req, res) => {
      res.json({ requests: await services.admin.schoolRequests() });
    }),
  );

  router.post(
    '/school-requests/:id/resolve',
    asyncHandler(async (req, res) => {
      const body = parseBody(z.object({ action: z.enum(['added', 'rejected']) }), req.body);
      await services.admin.resolveSchoolRequest(req.params.id!, body.action, adminUid(req));
      res.json({ ok: true });
    }),
  );

  router.get(
    '/config/pricing',
    asyncHandler(async (_req, res) => {
      res.json({ pricing: await getPricing(store) });
    }),
  );

  router.put(
    '/config/pricing',
    asyncHandler(async (req, res) => {
      const pricing = await setPricing(store, req.body);
      await services.admin.log(adminUid(req), 'config.pricing', 'config/pricing');
      res.json({ pricing });
    }),
  );

  router.get(
    '/ledger',
    asyncHandler(async (_req, res) => {
      const entries = await services.admin.ledgerEntries();
      res.json({ entries });
    }),
  );

  router.get(
    '/ledger.csv',
    asyncHandler(async (_req, res) => {
      const csv = await services.admin.ledgerCsv();
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader(
        'content-disposition',
        `attachment; filename="logit-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    }),
  );

  router.get(
    '/audit',
    asyncHandler(async (_req, res) => {
      res.json({ entries: await services.admin.auditLog() });
    }),
  );

  router.get(
    '/storage',
    asyncHandler(async (_req, res) => {
      const used = await storage.usedBytes('');
      res.json({
        usedBytes: used,
        budgetBytes: config.storageBudgetBytes,
        ratio: used / config.storageBudgetBytes,
        blocked: used / config.storageBudgetBytes >= 0.9,
      });
    }),
  );

  router.get(
    '/launch-readiness',
    asyncHandler(async (_req, res) => {
      const templates = await services.templates.listAll();
      const publishedTemplates = templates.filter((template) => template.status === 'published').length;
      const used = await storage.usedBytes('');
      const storageRatio = used / config.storageBudgetBytes;
      const providersLive =
        config.authMode === 'firebase' &&
        config.storageDriver === 's3' &&
        services.ai.name !== 'mock' &&
        config.paymentsProvider !== 'mock';
      const checks = [
        {
          key: 'admin-email',
          label: 'Admin bootstrap email is the owner’s real email',
          ok: config.adminBootstrapEmail !== 'admin@uselogit.cv',
          detail: config.adminBootstrapEmail,
        },
        {
          key: 'support',
          label: 'Support email and WhatsApp set',
          ok: Boolean(config.supportEmail) && !config.supportWhatsapp.startsWith('2348000'),
          detail: `${config.supportEmail} · ${config.supportWhatsapp}`,
        },
        {
          key: 'dpo',
          label: 'Data protection contact set',
          ok: Boolean(config.dpoContact),
          detail: config.dpoContact,
        },
        {
          key: 'providers',
          label: 'Live providers (Firebase, S3, Gemini, Paystack)',
          ok: providersLive,
          detail: `auth=${config.authMode} storage=${config.storageDriver} ai=${services.ai.name} pay=${config.paymentsProvider}`,
        },
        {
          key: 'templates',
          label: 'At least one published layout',
          ok: publishedTemplates > 0,
          detail: `${publishedTemplates} published of ${templates.length}`,
        },
        {
          key: 'retention',
          label: 'Retention within policy (≤30 days files, 180 days entries)',
          ok: config.retentionDays <= 30 && config.entriesRetentionDays <= 365,
          detail: `${config.retentionDays} days files · ${config.entriesRetentionDays} days entries`,
        },
        {
          key: 'storage',
          label: 'Storage below the 90% guard',
          ok: storageRatio < 0.9,
          detail: `${Math.round(storageRatio * 100)}% used`,
        },
      ];
      res.json({
        checks,
        modes: {
          auth: config.authMode,
          store: config.storeDriver,
          storage: config.storageDriver,
          ai: services.ai.name,
          payments: config.paymentsProvider,
        },
        contacts: {
          supportEmail: config.supportEmail,
          supportWhatsapp: config.supportWhatsapp,
          dpo: config.dpoContact,
        },
        retention: {
          retentionDays: config.retentionDays,
          entriesRetentionDays: config.entriesRetentionDays,
        },
        publishedTemplates,
        brandExpected: [
          '/brand/logo.svg',
          '/brand/logo-mark.svg',
          '/brand/favicon.svg',
          '/brand/favicon.ico',
          '/brand/apple-touch-icon.png',
          '/brand/icon-192.png',
          '/brand/icon-512.png',
          '/brand/og-image.png',
        ],
      });
    }),
  );

  return router;
}
