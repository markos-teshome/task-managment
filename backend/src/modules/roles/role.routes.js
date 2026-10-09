import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission, requireAnyPermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idParam, optionalText } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import { ALL_PERMISSION_KEYS } from '../../common/constants/permissions.js';
import * as roles from './role.service.js';

const router = Router();
router.use(tenantRoute);

const permissionList = z.array(z.enum(ALL_PERMISSION_KEYS)).max(ALL_PERMISSION_KEYS.length).transform((l) => [...new Set(l)]);

const createBody = z
  .object({
    name: z.string().trim().min(2).max(40),
    description: optionalText(200),
    permissions: permissionList,
  })
  .strict();

const updateBody = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    description: optionalText(200).optional(),
    permissions: permissionList.optional(),
  })
  .strict();

// The invite and edit-member forms need the role list, so member managers can read it too.
router.get('/', requireAnyPermission('ROLE_VIEW', 'USER_CREATE', 'USER_UPDATE'), async (req, res) => {
  ok(res, await roles.listRoles(req.ctx));
});

router.get('/permissions', requirePermission('ROLE_VIEW'), (_req, res) => {
  ok(res, roles.listPermissionCatalog());
});

router.post('/', requirePermission('ROLE_CREATE'), validate({ body: createBody }), async (req, res) => {
  created(res, await roles.createRole(req.ctx, req.valid.body));
});

router.patch('/:id', requirePermission('ROLE_UPDATE'), validate({ params: idParam, body: updateBody }), async (req, res) => {
  ok(res, await roles.updateRole(req.ctx, req.valid.params.id, req.valid.body));
});

router.delete('/:id', requirePermission('ROLE_DELETE'), validate({ params: idParam }), async (req, res) => {
  await roles.deleteRole(req.ctx, req.valid.params.id);
  ok(res, { deleted: true });
});

export default router;
