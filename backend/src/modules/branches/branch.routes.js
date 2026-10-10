import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { id, idParam, optionalText, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import * as branches from './branch.service.js';

/**
 * Branches of the caller's active organization. Fine-grained rules (branch managers, visibility,
 * default branch, archiving) live in branch.service.js; routes only add what needs a permission outright.
 */
const router = Router();
router.use(tenantRoute);

const name = z.string().transform((v) => v.trim().replace(/\s+/g, ' ')).pipe(z.string().min(2, 'Branch name is too short').max(80));
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use up to 20 letters, digits, - or _')
  .nullish()
  .transform((v) => v || null);

const createBody = z
  .object({ name, code, description: optionalText(500), address: optionalText(300), managerId: id.nullish() })
  .strict();

const updateBody = z
  .object({
    name: name.optional(),
    code: code.optional(),
    description: optionalText(500).optional(),
    address: optionalText(300).optional(),
    managerId: id.nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    isDefault: z.literal(true).optional(), // the default moves to this branch; it cannot be "unset"
    // When archiving a branch with active projects: another branch's id, or null = organization-wide.
    reassignProjectsTo: id.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const listQuery = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']).optional(), search: searchTerm });
const membersBody = z.object({ membershipIds: z.array(id).min(1).max(100) }).strict();
const memberParams = z.object({ id, membershipId: id });

router.get('/', validate({ query: listQuery }), async (req, res) => ok(res, await branches.listBranches(req.ctx, req.valid.query)));

router.post('/', requirePermission('BRANCH_MANAGE'), validate({ body: createBody }), async (req, res) => {
  created(res, await branches.createBranch(req.ctx, req.valid.body));
});

router.get('/:id', validate({ params: idParam }), async (req, res) => ok(res, await branches.getBranch(req.ctx, req.valid.params.id)));

router.patch('/:id', validate({ params: idParam, body: updateBody }), async (req, res) => {
  ok(res, await branches.updateBranch(req.ctx, req.valid.params.id, req.valid.body));
});

router.post('/:id/members', validate({ params: idParam, body: membersBody }), async (req, res) => {
  ok(res, await branches.addBranchMembers(req.ctx, req.valid.params.id, req.valid.body.membershipIds));
});

router.delete('/:id/members/:membershipId', validate({ params: memberParams }), async (req, res) => {
  ok(res, await branches.removeBranchMember(req.ctx, req.valid.params.id, req.valid.params.membershipId));
});

export default router;
