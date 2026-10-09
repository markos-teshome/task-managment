import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission, requireAnyPermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { email, id, idParam, optionalText, pagination, personName, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import * as members from './member.service.js';

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

// Pickers (assignee, project lead, team) need active member names without full team access.
router.get(
  '/options',
  requireAnyPermission('USER_VIEW', 'TASK_ASSIGN', 'PROJECT_CREATE', 'PROJECT_UPDATE'),
  async (req, res) => ok(res, await members.listMemberOptions(req.ctx)),
);

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
