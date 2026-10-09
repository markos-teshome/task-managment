import { Router } from 'express';
import { z } from 'zod';
import { authenticate, tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { ok, created } from '../../common/utils/http.js';
import { createOrganization, getCurrentOrganization, updateOrganization } from './organization.service.js';
import { switchSessionWorkspace } from '../auth/auth.service.js';

const router = Router();

const orgBody = z.object({ name: z.string().trim().min(2, 'Organization name is too short').max(80) }).strict();

/**
 * POST /organizations — onboarding step after email verification. Any signed-in, verified
 * user may create a workspace; the new workspace becomes the session's active one.
 */
router.post('/', authenticate, validate({ body: orgBody }), async (req, res) => {
  const { membership } = await createOrganization(req.ctx.userId, req.valid.body);
  const session = await switchSessionWorkspace(req.ctx, membership.id);
  created(res, session);
});

/** The organization is always the caller's current one — there is no :id to tamper with. */
router.get('/current', tenantRoute, async (req, res) => {
  ok(res, await getCurrentOrganization(req.ctx));
});

router.patch('/current', tenantRoute, requirePermission('ORG_MANAGE'), validate({ body: orgBody }), async (req, res) => {
  ok(res, await updateOrganization(req.ctx, req.valid.body));
});

export default router;
