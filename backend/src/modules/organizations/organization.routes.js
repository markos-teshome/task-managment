import { Router } from 'express';
import { z } from 'zod';
import { authenticate, tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { ok, created } from '../../common/utils/http.js';
import { organizationName } from '../../common/validators/index.js';
import { createOrganization, getCurrentOrganization, updateOrganization } from './organization.service.js';
import { switchSessionWorkspace } from '../auth/auth.service.js';

const router = Router();

const orgBody = z.object({ name: organizationName }).strict();

/**
 * POST /organizations — onboarding step after email verification. Any signed-in, verified
 * user may create a workspace (they become its Owner); it becomes the session's active one.
 * Only a new organization can be created here: nobody can attach themselves to an existing one
 * (joining an existing organization is done by accepting an invitation).
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
