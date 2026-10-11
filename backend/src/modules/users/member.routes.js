import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission, requireAnyPermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { email, id, idParam, optionalText, pagination, personName, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import * as members from './member.service.js';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';

const router = Router();
router.use(tenantRoute);

const listQuery = z.object({
  ...pagination,
  search: searchTerm,
  roleId: id.optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']).optional(),
});

const inviteBody = z
  .object({ email, firstName: personName, lastName: personName, roleId: id, jobTitle: optionalText(80) })
  .strict();

const updateBody = z
  .object({
    roleId: id.optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
    jobTitle: optionalText(80).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

router.get('/', requirePermission('USER_VIEW'), validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await members.listMembers(req.ctx, req.valid.query);
  ok(res, items, meta);
});

// Pickers (assignee, project lead, team, branch members) need active member names without full team access.
// F-01: people who manage a branch may pick members for it whatever their role.
async function canPickMembers(req, _res, next) {
  if (['USER_VIEW', 'TASK_ASSIGN', 'PROJECT_CREATE', 'PROJECT_UPDATE'].some((p) => req.ctx.can(p))) return next();
  const manages = await prisma.branch.count({ where: { organizationId: req.ctx.organizationId, managerId: req.ctx.membershipId, status: 'ACTIVE' } });
  return manages ? next() : next(Errors.forbidden());
}
router.get('/options', canPickMembers, async (req, res) => ok(res, await members.listMemberOptions(req.ctx)));

router.get('/:id/responsibilities', requireAnyPermission('USER_UPDATE', 'USER_DELETE'), validate({ params: idParam }), async (req, res) => {
  ok(res, await members.getResponsibilities(req.ctx, req.valid.params.id));
});

router.post('/', requirePermission('USER_CREATE'), validate({ body: inviteBody }), async (req, res) => {
  created(res, await members.inviteMember(req.ctx, req.valid.body));
});

router.post('/:id/resend-invitation', requirePermission('USER_CREATE'), validate({ params: idParam }), async (req, res) => {
  await members.resendInvitation(req.ctx, req.valid.params.id);
  ok(res, { message: 'Invitation sent again.' });
});

router.patch('/:id', requirePermission('USER_UPDATE'), validate({ params: idParam, body: updateBody }), async (req, res) => {
  ok(res, await members.updateMember(req.ctx, req.valid.params.id, req.valid.body));
});

router.delete('/:id', requirePermission('USER_DELETE'), validate({ params: idParam }), async (req, res) => {
  const result = await members.removeMember(req.ctx, req.valid.params.id);
  ok(res, result ?? { revoked: true });
});

export default router;
