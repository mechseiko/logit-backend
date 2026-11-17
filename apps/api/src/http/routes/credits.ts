import { Router } from 'express';
import { paymentInitializeSchema } from '@logit/shared';
import type { AppConfig } from '../../config.js';
import { requireProfile } from '../context.js';
import { asyncHandler, parseBody } from '../middleware.js';
import type { Services } from '../../services/index.js';

export function createCreditsRouter(services: Services, config: AppConfig): Router {
  const router = Router();

  router.get(
    '/credits',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const { balance, reserved } = await services.credits.balance(profile.uid);
      const ledger = await services.credits.list(profile.uid, 40, cursor);
      res.json({
        balance,
        reserved,
        ledger,
        nextCursor: ledger.length === 40 ? ledger[ledger.length - 1]?.createdAt : undefined,
      });
    }),
  );

  router.post(
    '/payments/initialize',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const body = parseBody(paymentInitializeSchema, req.body);
      const result = await services.payments.initialize(profile.uid, body);
      res.json({ ...result, provider: config.paymentsProvider });
    }),
  );

  router.get(
    '/payments/verify/:reference',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const result = await services.payments.verifyForUser(profile.uid, req.params.reference!);
      res.json(result);
    }),
  );

  router.get(
    '/payments/history',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const payments = await services.payments.history(profile.uid);
      res.json({ payments });
    }),
  );

  router.get(
    '/referrals',
    asyncHandler(async (req, res) => {
      const profile = requireProfile(req);
      const stats = await services.referrals.stats(profile.uid);
      res.json(stats);
    }),
  );

  return router;
}
