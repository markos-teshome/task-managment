import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { dateOnly, id, idParam, optionalText, pagination, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import * as tasks from './task.service.js';

const router = Router();
router.use(tenantRoute);

const status = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
// Accepts ?status=TODO,IN_PROGRESS or repeated ?status=… params.
const csvEnum = (schema) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(schema).min(1))
    .optional();

const filters = {
  search: searchTerm,
  projectId: id.optional(),
  status: csvEnum(status),
  priority: csvEnum(priority),
  assigneeId: z.union([z.literal('me'), z.literal('unassigned'), id]).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  // D-11: include tasks of archived projects (read-only history).
  includeArchived: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
};

const listQuery = z.object({
  ...pagination,
  ...filters,
  sort: z.enum(['dueDate', 'priority', 'status', 'createdAt', 'title']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const createBody = z
  .object({
    projectId: id,
    title: z.string().trim().min(2, 'Task title is too short').max(200),
    description: optionalText(5000),
    status: status.default('TODO'),
    priority: priority.default('MEDIUM'),
    assigneeId: id.nullish(),
    dueDate: dateOnly.nullish(),
  })
  .strict();

const updateBody = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: optionalText(5000).optional(),
    status: status.optional(),
    priority: priority.optional(),
    assigneeId: id.nullable().optional(),
    dueDate: dateOnly.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

router.get('/', requirePermission('TASK_VIEW'), validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await tasks.listTasks(req.ctx, req.valid.query);
  ok(res, items, meta);
});

router.get('/my-work', requirePermission('TASK_VIEW'), async (req, res) => {
  ok(res, await tasks.myWork(req.ctx));
});

router.get('/export', requirePermission('TASK_VIEW'), validate({ query: z.object(filters) }), async (req, res) => {
  const csv = await tasks.exportTasksCsv(req.ctx, req.valid.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.post('/', requirePermission('TASK_CREATE'), validate({ body: createBody }), async (req, res) => {
  created(res, await tasks.createTask(req.ctx, req.valid.body));
});

router.get('/:id', requirePermission('TASK_VIEW'), validate({ params: idParam }), async (req, res) => {
  ok(res, await tasks.getTask(req.ctx, req.valid.params.id));
});

// TASK_VIEW only: the service decides between full edit (TASK_UPDATE) and assignee status updates.
router.patch('/:id', requirePermission('TASK_VIEW'), validate({ params: idParam, body: updateBody }), async (req, res) => {
  ok(res, await tasks.updateTask(req.ctx, req.valid.params.id, req.valid.body));
});

router.delete('/:id', requirePermission('TASK_DELETE'), validate({ params: idParam }), async (req, res) => {
  await tasks.deleteTask(req.ctx, req.valid.params.id);
  ok(res, { deleted: true });
});

export default router;
