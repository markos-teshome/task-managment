import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { dateOnly, id, pagination } from '../../common/validators/index.js';
import { ok } from '../../common/utils/http.js';
import { listActivities } from './activity.service.js';

const router = Router();

const listQuery = z.object({
  ...pagination,
  actorId: id.optional(),
  projectId: id.optional(),
  entityId: id.optional(),
  entityType: z.enum(['ORGANIZATION', 'MEMBER', 'ROLE', 'PROJECT', 'TASK', 'SUBSCRIPTION', 'PAYMENT']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

router.get('/', tenantRoute, requirePermission('ACTIVITY_VIEW'), validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await listActivities(req.ctx, req.valid.query);
  ok(res, items, meta);
});

export default router;
