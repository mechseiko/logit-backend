import { Router } from 'express';
import { schoolRequestSchema } from '@logit/shared';
import type { Store } from '../../db/index.js';
import { requireProfile } from '../context.js';
import { asyncHandler, parseBody } from '../middleware.js';
import { searchSchools } from '../../services/schools.js';

export function createSchoolsRouter(store: Store): Router {
  const router = Router();

  router.get(
    '/schools',
    asyncHandler(async (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
      const schools = await searchSchools(store, query, query ? 20 : 40);
      res.json({
        schools: schools.map((school) => ({
          id: school.id,
          name: school.name,
          shortName: school.shortName,
          state: school.state,
          type: school.type,
        })),
      });
    }),
  );

  router.post(
    '/schools/request',
    asyncHandler(async (req, res) => {
      requireProfile(req);
      const body = parseBody(schoolRequestSchema, req.body);
      const id = `schreq_${Date.now().toString(36)}`;
      await store.set(`schoolRequests/${id}`, {
        id,
        uid: req.authUser!.uid,
        name: body.name,
        createdAt: new Date().toISOString(),
        status: 'open',
      });
      res.json({ ok: true, id });
    }),
  );

  return router;
}
