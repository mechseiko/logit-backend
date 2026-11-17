import { Router } from 'express';
import { bootstrapSchema, onboardingSchema, profileUpdateSchema } from '@logit/shared';
import type { AppConfig } from '../../config.js';
import type { Store } from '../../db/index.js';
import { requireAuthUser, requireProfile } from '../context.js';
import { asyncHandler, parseBody } from '../middleware.js';
import type { Services } from '../../services/index.js';

export function createMeRouter(services: Services, _store: Store, config: AppConfig): Router {
  const router = Router();

  router.post(
    '/bootstrap',
    asyncHandler(async (req, res) => {
      const authUser = requireAuthUser(req);
      const body = parseBody(bootstrapSchema, req.body ?? {});
      const { user, isAdmin } = await services.users.bootstrap(authUser, body.referralCode);
      res.json({
        user,
        isAdmin,
        meta: {
          devAuth: config.authMode === 'dev' && !config.isProd,
          aiProvider: services.ai.name,
          paymentsProvider: config.paymentsProvider,
        },
      });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const authUser = requireAuthUser(req);
      const profile =
        req.profile ?? (await services.users.bootstrap(authUser).then((result) => result.user));
      res.json({
        user: profile,
        isAdmin: await services.users.isAdmin(authUser.uid),
        share: {
          supportEmail: config.supportEmail,
          supportWhatsapp: config.supportWhatsapp,
        },
      });
    }),
  );

  router.patch(
    '/onboarding',
    asyncHandler(async (req, res) => {
      const authUser = requireAuthUser(req);
      const body = parseBody(onboardingSchema, req.body);
      const user = await services.users.updateOnboarding(authUser.uid, body);
      res.json({ user });
    }),
  );

  router.patch(
    '/profile',
    asyncHandler(async (req, res) => {
      requireProfile(req);
      const body = parseBody(profileUpdateSchema, req.body);
      const user = await services.users.updateProfile(requireAuthUser(req).uid, body);
      res.json({ user });
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (req, res) => {
      requireProfile(req);
      await services.users.deleteAccount(requireAuthUser(req).uid);
      res.json({ ok: true });
    }),
  );

  return router;
}
