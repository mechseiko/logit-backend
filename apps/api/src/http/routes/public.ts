import express, { Router } from 'express';
import { z } from 'zod';
import { APP_NAME, APP_TAGLINE, CONSENT_VERSION, pricingForDisplay } from '@logit/shared';
import type { AppConfig } from '../../config.js';
import type { Store } from '../../db/index.js';
import { ApiError, notFound } from '../../errors.js';
import { createDevToken } from '../../auth.js';
import { asyncHandler, parseBody } from '../middleware.js';
import { signFileToken, verifyFileToken, type StorageAdapter } from '../../services/storage/index.js';
import { getPricing } from '../../services/pricing.js';
import { pipelineHealthy, toolStatus } from '../../services/pdf/selftest.js';
import type { Services } from '../../services/index.js';

export interface PublicRouterDeps {
  config: AppConfig;
  store: Store;
  storage: StorageAdapter;
  services: Services;
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export function createPublicRouter(deps: PublicRouterDeps): Router {
  const { config, store, storage, services } = deps;
  const router = Router();

  router.get('/health', (_req, res) => {
    const tools = toolStatus();
    // Production must have the real raster pipeline; development may run on fallbacks.
    const healthy = config.isProd ? pipelineHealthy(tools) : true;
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      status: healthy ? 'ok' : 'degraded',
      service: 'logit-api',
      version: config.version,
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      modes: {
        auth: config.authMode,
        store: config.storeDriver,
        storage: config.storageDriver,
        ai: services.ai.name,
        payments: config.paymentsProvider,
      },
      pipeline: tools ?? { checked: false },
      retention: {
        retentionDays: config.retentionDays,
        maxRetentionDays: 30,
      },
    });
  });

  router.get(
    '/api/meta',
    asyncHandler(async (_req, res) => {
      const pricing = await getPricing(store);
      res.json({
        appName: APP_NAME,
        tagline: APP_TAGLINE,
        consentVersion: CONSENT_VERSION,
        contact: {
          email: config.supportEmail,
          whatsapp: config.supportWhatsapp,
          dpo: config.dpoContact,
        },
        legal: {
          entityName: config.legalEntityName,
          address: config.legalEntityAddress,
        },
        providers: {
          auth: config.authMode,
          ai: services.ai.name,
          payments: config.paymentsProvider,
          storage: config.storageDriver,
        },
        devAuth: config.authMode === 'dev' && !config.isProd,
        referral: pricing.referral,
      });
    }),
  );

  router.get(
    '/api/pricing',
    asyncHandler(async (_req, res) => {
      const pricing = await getPricing(store);
      res.json({ pricing: pricingForDisplay(pricing) });
    }),
  );

  // Public so the invite page can avoid promising credits for a code that does not exist.
  // Returns only a boolean: no owner, no profile, nothing enumerable beyond "this code exists".
  router.get(
    '/api/referrals/validate/:code',
    asyncHandler(async (req, res) => {
      const code = String(req.params.code ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        res.json({ valid: false });
        return;
      }
      const matches = await store.query<{ uid: string }>('users', {
        where: [['referralCode', '==', code]],
        limit: 1,
      });
      res.json({ valid: matches.length > 0 });
    }),
  );

  router.post(
    '/api/dev/signin',
    express.json({ limit: '10kb' }),
    asyncHandler(async (req, res) => {
      if (config.authMode !== 'dev' || config.isProd) throw notFound();
      const body = parseBody(
        z.object({
          email: z.string().trim().email(),
          name: z.string().trim().max(80).optional(),
        }),
        req.body,
      );
      res.json({ token: createDevToken(body.email, body.name) });
    }),
  );

  router.get(
    '/api/files',
    asyncHandler(async (req, res) => {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const payload = verifyFileToken(token, config.devAuthSecret);
      if (!payload || payload.mode !== 'get') {
        throw new ApiError(403, 'FORBIDDEN', 'This link expired. Reload the page.');
      }
      const bytes = await storage.get(payload.key).catch(() => null);
      if (!bytes) throw notFound('That file is no longer available.');
      res.setHeader('content-type', contentTypeFor(payload.key));
      res.setHeader('cache-control', 'private, max-age=300');
      res.setHeader(
        'content-disposition',
        payload.name ? `attachment; filename="${payload.name}"` : 'inline',
      );
      res.setHeader('content-length', String(bytes.byteLength));
      res.send(bytes);
    }),
  );

  router.put(
    '/api/files/upload',
    express.raw({ type: '*/*', limit: '12mb' }),
    asyncHandler(async (req, res) => {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const payload = verifyFileToken(token, config.devAuthSecret);
      if (!payload || payload.mode !== 'put') {
        throw new ApiError(403, 'FORBIDDEN', 'This upload link expired. Start the upload again.');
      }
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw new ApiError(400, 'VALIDATION', 'The upload was empty.');
      }
      if (payload.maxBytes && body.byteLength > payload.maxBytes) {
        throw new ApiError(413, 'TOO_LARGE', 'That file is larger than the limit.');
      }
      const declared = String(req.headers['content-type'] ?? '')
        .split(',')[0]!
        .trim()
        .toLowerCase();
      if (payload.mime && declared && declared !== payload.mime.toLowerCase()) {
        throw new ApiError(400, 'VALIDATION', 'The file type changed during upload.');
      }
      await storage.put(payload.key, body, payload.mime ?? 'application/octet-stream');
      res.json({ ok: true, key: payload.key, bytes: body.byteLength });
    }),
  );

  router.post(
    '/api/payments/webhook',
    express.raw({ type: '*/*', limit: '1mb' }),
    asyncHandler(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
      const signature = req.header('x-paystack-signature');
      await services.payments.handleWebhook(raw, signature);
      res.json({ ok: true });
    }),
  );

  // Used by tests to obtain a direct upload link without a browser.
  router.get(
    '/api/files/sign',
    asyncHandler(async (req, res) => {
      if (config.authMode !== 'dev' || config.isProd) throw notFound();
      const key = typeof req.query.key === 'string' ? req.query.key : '';
      const mode = req.query.mode === 'put' ? 'put' : 'get';
      if (!key) throw notFound();
      if (mode === 'get') {
        res.json({ url: await storage.signedGetUrl(key) });
        return;
      }
      const token = signFileToken(
        {
          key,
          exp: Date.now() + 900_000,
          mode: 'put',
          mime: typeof req.query.mime === 'string' ? req.query.mime : 'application/pdf',
          maxBytes: 10 * 1024 * 1024,
        },
        config.devAuthSecret,
      );
      res.json({ url: `${config.apiPublicUrl}/api/files/upload?token=${encodeURIComponent(token)}` });
    }),
  );

  return router;
}
