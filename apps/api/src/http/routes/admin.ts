import { Router } from 'express';
import { z } from 'zod';
import {
  adminAdjustSchema,
  adminBanSchema,
  profileInputSchema,
  schoolUpsertSchema,
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

  /**
   * Logbook profiles: the structure a document is built for. Six fields and a school, no box drawing.
   */
  router.get(
    '/profiles',
    asyncHandler(async (_req, res) => {
      res.json({ profiles: await services.profiles.listAll() });
    }),
  );

  router.post(
    '/profiles',
    asyncHandler(async (req, res) => {
      const body = parseBody(profileInputSchema, req.body);
      const profile = await services.profiles.create({ ...body, status: body.status ?? 'published' });
      await services.admin.log(adminUid(req), 'profile.create', profile.id);
      res.json({ profile });
    }),
  );

  router.put(
    '/profiles/:id',
    asyncHandler(async (req, res) => {
      const body = parseBody(profileInputSchema.partial(), req.body);
      const profile = await services.profiles.update(req.params.id!, body);
      await services.admin.log(adminUid(req), 'profile.update', profile.id);
      res.json({ profile });
    }),
  );

  router.delete(
    '/profiles/:id',
    asyncHandler(async (req, res) => {
      await services.profiles.remove(req.params.id!);
      await services.admin.log(adminUid(req), 'profile.delete', req.params.id!);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/uploads/presign',
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(200),
          type: z.string().min(1).max(100),
          // A blank logbook scan is routinely 20-30 MB before anyone compresses it, so the cap is
          // generous and the message names the real number instead of saying "invalid".
          size: z
            .number()
            .int()
            .min(1)
            .max(40 * 1024 * 1024, 'Template PDFs must be 40 MB or smaller.'),
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
      const profiles = await services.profiles.listAll();
      const publishedProfiles = profiles.filter((profile) => profile.status === 'published').length;
      const used = await storage.usedBytes('');
      const storageRatio = used / config.storageBudgetBytes;
      const providersLive =
        config.authMode === 'firebase' &&
        config.storageDriver === 's3' &&
        services.ai.name !== 'mock' &&
        config.paymentsProvider !== 'mock';
      // Prove the bucket accepts the server-side round trip an upload depends on, and that the
      // site origin is allowed to make the browser-side PUT. CORS itself can only be checked from
      // the origin, which the upload page does before sending files.
      const storageProbe = await storage.healthCheck().catch((error: unknown) => ({
        ok: false,
        detail: error instanceof Error ? error.message : 'storage probe failed',
      }));
      const uploadOriginCovered = config.allowedOrigins.some(
        (origin) => origin === config.appUrl || origin === config.appUrl.replace('https://', 'https://www.'),
      );
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
          key: 'profiles',
          label: 'At least one published logbook profile',
          ok: publishedProfiles > 0,
          detail: `${publishedProfiles} published of ${profiles.length}`,
        },
        {
          key: 'retention',
          label: 'Retention within policy (files and entries ≤ 30 days after last activity)',
          ok: config.retentionDays <= 30,
          detail: `${config.retentionDays} days after last activity, capped at 30 days from creation`,
        },
        {
          key: 'storage',
          label: 'Storage below the 90% guard',
          ok: storageRatio < 0.9,
          detail: `${Math.round(storageRatio * 100)}% used`,
        },
        {
          key: 'storage-writable',
          label: 'Object storage accepts writes (presigned uploads can land)',
          ok: storageProbe.ok,
          detail: `${storageProbe.detail} · browser origin ${config.appUrl} must be allowed in the bucket CORS rule`,
        },
        {
          key: 'upload-cors',
          label: 'Site origin is listed for uploads',
          ok: uploadOriginCovered,
          detail: uploadOriginCovered
            ? `${config.appUrl} is in ALLOWED_ORIGINS`
            : `${config.appUrl} is missing from ALLOWED_ORIGINS (${config.allowedOrigins.join(', ') || 'empty'})`,
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
        publishedProfiles,
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
