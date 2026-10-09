import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission, requireAnyPermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { dateOnly, id, idParam, optionalText, pagination, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import { recentActivities } from '../activities/activity.service.js';
import * as projects from './project.service.js';

const router = Router();
router.use(tenantRoute);

const status = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const canView = requireAnyPermission('PROJECT_VIEW', 'PROJECT_VIEW_ALL');

const listQuery = z.object({
  ...pagination,
  search: searchTerm,
  status: status.optional(),
  priority: priority.optional(),
  leadId: id.optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.enum(['name', 'dueDate', 'createdAt', 'priority', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const fields = {
  name: z.string().trim().min(2, 'Project name is too short').max(100),
  description: optionalText(2000),
  status,
  priority,
  startDate: dateOnly.nullable(),
  dueDate: dateOnly.nullable(),
  leadId: id.nullable(),
};

const createBody = z
  .object({
    ...fields,
    status: status.default('PLANNING'),
    priority: priority.default('MEDIUM'),
    startDate: fields.startDate.optional(),
    dueDate: fields.dueDate.optional(),
    leadId: fields.leadId.optional(),
    memberIds: z.array(id).max(100).optional(),
  })
  .strict();

const updateBody = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const membersBody = z.object({ membershipIds: z.array(id).min(1).max(100) }).strict();
const memberParams = z.object({ id, membershipId: id });

router.get('/', canView, validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await projects.listProjects(req.ctx, req.valid.query);
  ok(res, items, meta);
});

router.post('/', requirePermission('PROJECT_CREATE'), validate({ body: createBody }), async (req, res) => {
  created(res, await projects.createProject(req.ctx, req.valid.body));
});

router.get('/:id', canView, validate({ params: idParam }), async (req, res) => {
  ok(res, await projects.getProject(req.ctx, req.valid.params.id));
});

router.patch('/:id', requirePermission('PROJECT_UPDATE'), validate({ params: idParam, body: updateBody }), async (req, res) => {
  ok(res, await projects.updateProject(req.ctx, req.valid.params.id, req.valid.body));
});

router.post('/:id/archive', requirePermission('PROJECT_UPDATE'), validate({ params: idParam }), async (req, res) => {
  ok(res, await projects.setArchived(req.ctx, req.valid.params.id, true));
});

router.post('/:id/restore', requirePermission('PROJECT_UPDATE'), validate({ params: idParam }), async (req, res) => {
  ok(res, await projects.setArchived(req.ctx, req.valid.params.id, false));
});

router.delete('/:id', requirePermission('PROJECT_DELETE'), validate({ params: idParam }), async (req, res) => {
  await projects.deleteProject(req.ctx, req.valid.params.id);
  ok(res, { deleted: true });
});

router.post('/:id/members', requirePermission('PROJECT_UPDATE'), validate({ params: idParam, body: membersBody }), async (req, res) => {
  ok(res, await projects.addProjectMembers(req.ctx, req.valid.params.id, req.valid.body.membershipIds));
});

router.delete('/:id/members/:membershipId', requirePermission('PROJECT_UPDATE'), validate({ params: memberParams }), async (req, res) => {
  ok(res, await projects.removeProjectMember(req.ctx, req.valid.params.id, req.valid.params.membershipId));
});

router.get('/:id/activity', requirePermission('ACTIVITY_VIEW'), validate({ params: idParam }), async (req, res) => {
  await projects.findVisibleProject(req.ctx, req.valid.params.id);
  ok(res, await recentActivities(req.ctx.organizationId, { projectId: req.valid.params.id, take: 50 }));
});

export default router;
