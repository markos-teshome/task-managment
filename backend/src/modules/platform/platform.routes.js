import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePlatformAdmin } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idParam, optionalText, pagination, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import { FEATURES } from '../../common/constants/plans.js';
import * as platform from './platform.service.js';

const router = Router();
router.use(authenticate, requirePlatformAdmin);

const limit = z.number().int().min(1).max(100000).nullable();
const planFields = {
  name: z.string().trim().min(2).max(40),
  description: optionalText(200),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).toUpperCase().default('ETB'),
  maxUsers: limit,
  maxProjects: limit,
  features: z.array(z.enum(Object.values(FEATURES))).transform((l) => [...new Set(l)]),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};

const createPlanBody = z
  .object({ code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/), ...planFields, isActive: planFields.isActive.default(true), sortOrder: planFields.sortOrder.default(10) })
  .strict();
const updatePlanBody = z
  .object(Object.fromEntries(Object.entries(planFields).map(([k, v]) => [k, v.optional()])))
  .strict();

router.get('/overview', async (_req, res) => ok(res, await platform.overview()));

router.get(
  '/organizations',
  validate({ query: z.object({ ...pagination, search: searchTerm, status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }) }),
  async (req, res) => {
    const { items, meta } = await platform.listOrganizations(req.valid.query);
    ok(res, items, meta);
  },
);

router.patch(
  '/organizations/:id',
  validate({ params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict() }),
  async (req, res) => ok(res, await platform.setOrganizationStatus(req.ctx.userId, req.valid.params.id, req.valid.body.status)),
);

router.get('/plans', async (_req, res) => ok(res, await platform.listAllPlans()));
router.post('/plans', validate({ body: createPlanBody }), async (req, res) => created(res, await platform.createPlan(req.ctx.userId, req.valid.body)));
router.patch('/plans/:id', validate({ params: idParam, body: updatePlanBody }), async (req, res) => {
  ok(res, await platform.updatePlan(req.ctx.userId, req.valid.params.id, req.valid.body));
});

router.get('/payments', validate({ query: z.object(pagination) }), async (req, res) => {
  const { items, meta } = await platform.recentPayments(req.valid.query);
  ok(res, items, meta);
});

router.get('/audit-log', validate({ query: z.object(pagination) }), async (req, res) => {
  const { items, meta } = await platform.listAuditLog(req.valid.query);
  ok(res, items, meta);
});

export default router;
