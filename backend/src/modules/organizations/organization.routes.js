import { Router } from 'express';
import { z } from 'zod';
import { authenticate, tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { id } from '../../common/validators/index.js';
import { validate } from '../../common/middleware/validate.js';
import { ok, created } from '../../common/utils/http.js';
import { organizationName } from '../../common/validators/index.js';
import { createOrganization, getCurrentOrganization, listMyOrganizations, membershipFor, updateOrganization } from './organization.service.js';
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

/**
 * POST /organizations/switch — makes another of the caller's organizations the session's active one.
 * The new security context (membership, role, permissions, plan) is loaded from the database on the
 * very next request; the response carries a fresh access token and profile for it.
 */
router.post('/switch', authenticate, validate({ body: z.object({ organizationId: id }).strict() }), async (req, res) => {
  const membershipId = await membershipFor(req.ctx, req.valid.body.organizationId);
  ok(res, await switchSessionWorkspace(req.ctx, membershipId));
});

/** The organization is always the caller's current one — there is no :id to tamper with. */
router.get('/current', tenantRoute, async (req, res) => {
  ok(res, await getCurrentOrganization(req.ctx));
});

router.patch('/current', tenantRoute, requirePermission('ORG_MANAGE'), validate({ body: orgBody }), async (req, res) => {
  ok(res, await updateOrganization(req.ctx, req.valid.body));
});

export default router;

/** /me/* — the signed-in person, across organizations. */
export const meRouter = Router();
meRouter.get('/organizations', authenticate, async (req, res) => ok(res, await listMyOrganizations(req.ctx)));
