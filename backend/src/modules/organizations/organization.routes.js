import { Router } from 'express';
import { z } from 'zod';
import { authenticate, billingRoute, tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { id, optionalText, organizationName } from '../../common/validators/index.js';
import { validate } from '../../common/middleware/validate.js';
import { ok, created } from '../../common/utils/http.js';
import {
  createOrganization, getCurrentOrganization, leaveOrganization, listMyOrganizations, membershipFor, requestClosure, transferOwnership, updateOrganization, withdrawClosure,
} from './organization.service.js';
import { moveSessionToDefaultWorkspace, switchSessionWorkspace } from '../auth/auth.service.js';

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
// Also open to a suspended company's billing manager (D-13): the billing page needs the company name and plan.
router.get('/current', billingRoute, async (req, res) => {
  ok(res, await getCurrentOrganization(req.ctx));
});

router.patch('/current', tenantRoute, requirePermission('ORG_MANAGE'), validate({ body: orgBody }), async (req, res) => {
  ok(res, await updateOrganization(req.ctx, req.valid.body));
});

const password = z.string().min(1, 'Enter your password').max(200);

// D-7: transfer ownership (owners), leave (anyone; never the last owner).
router.post(
  '/current/ownership',
  tenantRoute,
  validate({ body: z.object({ membershipId: id, password, newRoleId: id.nullish() }).strict() }),
  async (req, res) => {
    await transferOwnership(req.ctx, req.valid.body);
    ok(res, await switchSessionWorkspace(req.ctx, req.ctx.membershipId)); // fresh token + profile with the new role
  },
);

router.post('/current/leave', tenantRoute, validate({ body: z.object({ password }).strict() }), async (req, res) => {
  await leaveOrganization(req.ctx, req.valid.body);
  ok(res, await moveSessionToDefaultWorkspace(req.ctx));
});

// D-9: closure request (owners) — recorded, reversible, processed by the platform; nothing is deleted.
router.post(
  '/current/closure',
  tenantRoute,
  validate({ body: z.object({ reason: optionalText(500), confirmName: z.string().max(100), password }).strict() }),
  async (req, res) => ok(res, await requestClosure(req.ctx, req.valid.body)),
);
router.delete('/current/closure', tenantRoute, async (req, res) => ok(res, await withdrawClosure(req.ctx)));

export default router;

/** /me/* — the signed-in person, across organizations. */
export const meRouter = Router();
meRouter.get('/organizations', authenticate, async (req, res) => ok(res, await listMyOrganizations(req.ctx)));
