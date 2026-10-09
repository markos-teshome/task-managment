import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { FEATURES } from '../../common/constants/plans.js';
import { addDays, fullName, paginate, startOfTodayUtc } from '../../common/utils/http.js';
import { assertFeature } from '../subscriptions/entitlement.service.js';
import { resolveActiveMembers } from '../users/member.service.js';
import { visibleProjectsWhere } from '../projects/project.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * A task is visible when its project is visible to the caller, or when it is assigned to them
 * (so people keep seeing their own work even after leaving a project team).
 */
export function visibleTasksWhere(ctx) {
  const { organizationId, ...projectFilter } = visibleProjectsWhere(ctx);
  return {
    organizationId,
    project: { archivedAt: null },
    ...(Object.keys(projectFilter).length && {
      OR: [{ project: projectFilter }, { assigneeId: ctx.membershipId }],
    }),
  };
}

const taskInclude = {
  project: { select: { id: true, name: true, archivedAt: true } },
  assignee: { select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } } },
  createdBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
};

const present = (t) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate,
  completedAt: t.completedAt,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  project: { id: t.project.id, name: t.project.name },
  assignee: t.assignee ? { id: t.assignee.id, name: fullName(t.assignee.user), status: t.assignee.status } : null,
  createdBy: t.createdBy ? { id: t.createdBy.id, name: fullName(t.createdBy.user) } : null,
});

function dueFilter(due) {
  const today = startOfTodayUtc();
  const open = { status: { not: 'COMPLETED' } };
  switch (due) {
    case 'overdue': return { ...open, dueDate: { lt: today } };
    case 'today': return { dueDate: today };
    case 'week': return { ...open, dueDate: { gte: today, lt: addDays(today, 7) } };
    case 'none': return { dueDate: null };
    default: return {};
  }
}

function buildListWhere(ctx, q) {
  const and = [visibleTasksWhere(ctx), dueFilter(q.due)];
  if (q.projectId) and.push({ projectId: q.projectId });
  if (q.status) and.push({ status: { in: q.status } });
  if (q.priority) and.push({ priority: { in: q.priority } });
  if (q.assigneeId === 'me') and.push({ assigneeId: ctx.membershipId });
  else if (q.assigneeId === 'unassigned') and.push({ assigneeId: null });
  else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
  if (q.search) {
    and.push({
      OR: [
        { title: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

const SORTS = {
  dueDate: (dir) => [{ dueDate: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' }],
  priority: (dir) => [{ priority: dir }, { createdAt: 'desc' }],
  status: (dir) => [{ status: dir }, { createdAt: 'desc' }],
  createdAt: (dir) => [{ createdAt: dir }],
  title: (dir) => [{ title: dir }],
};

export async function listTasks(ctx, query) {
  const { skip, take, meta } = paginate(query);
  const where = buildListWhere(ctx, query);
  const [items, total] = await prisma.$transaction([
    prisma.task.findMany({ where, include: taskInclude, orderBy: SORTS[query.sort](query.order), skip, take }),
    prisma.task.count({ where }),
  ]);
  return { items: items.map(present), meta: meta(total) };
}

/** The caller's own work, bucketed the way people plan their day. */
export async function myWork(ctx) {
  const today = startOfTodayUtc();
  const mine = { ...visibleTasksWhere(ctx), assigneeId: ctx.membershipId };
  const open = { ...mine, status: { not: 'COMPLETED' } };
  const query = (where, orderBy, take = 50) => prisma.task.findMany({ where, include: taskInclude, orderBy, take });

  const [overdue, dueToday, upcoming, noDate, completed] = await Promise.all([
    query({ ...open, dueDate: { lt: today } }, [{ dueDate: 'asc' }]),
    query({ ...open, dueDate: today }, [{ priority: 'desc' }]),
    query({ ...open, dueDate: { gt: today } }, [{ dueDate: 'asc' }]),
    query({ ...open, dueDate: null }, [{ priority: 'desc' }, { createdAt: 'desc' }]),
    query({ ...mine, status: 'COMPLETED', completedAt: { gte: addDays(today, -14) } }, [{ completedAt: 'desc' }], 20),
  ]);
  return {
    overdue: overdue.map(present),
    today: dueToday.map(present),
    upcoming: [...upcoming, ...noDate].map(present),
    completed: completed.map(present),
  };
}

async function findVisibleTask(ctx, id) {
  const task = await prisma.task.findFirst({ where: { id, ...visibleTasksWhere(ctx) }, include: taskInclude });
  if (!task) throw Errors.notFound('Task');
  return task;
}

export const getTask = async (ctx, id) => present(await findVisibleTask(ctx, id));

/** Assignee must be an active member of this organization; they join the project team if needed. */
async function prepareAssignee(tx, ctx, projectId, assigneeId) {
  if (!assigneeId) return null;
  const [member] = await resolveActiveMembers(tx, ctx.organizationId, [assigneeId], 'assigneeId');
  await tx.projectMember.upsert({
    where: { projectId_membershipId: { projectId, membershipId: assigneeId } },
    update: {},
    create: { projectId, membershipId: assigneeId, organizationId: ctx.organizationId },
  });
  return member;
}

export async function createTask(ctx, data) {
  const project = await prisma.project.findFirst({ where: { id: data.projectId, ...visibleProjectsWhere(ctx) } });
  if (!project) throw Errors.validation([{ field: 'projectId', message: 'Select a project you have access to' }]);
  if (project.archivedAt) throw Errors.conflict('This project is archived. Restore it to add tasks.', 'PROJECT_ARCHIVED');
  if (data.assigneeId && !ctx.can('TASK_ASSIGN')) throw Errors.forbidden('You do not have permission to assign tasks.');

  const task = await prisma.$transaction(async (tx) => {
    const assignee = await prepareAssignee(tx, ctx, project.id, data.assigneeId);
    const created = await tx.task.create({
      data: {
        ...data,
        organizationId: ctx.organizationId,
        createdById: ctx.membershipId,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
      include: taskInclude,
    });
    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'TASK', entityId: created.id, projectId: project.id };
    await logActivity(tx, { ...base, action: ACTIONS.TASK_CREATED, metadata: { title: created.title, projectName: project.name } });
    if (assignee) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_ASSIGNED, metadata: { title: created.title, assigneeName: fullName(assignee.user) } });
    }
    return created;
  });
  return present(task);
}

/**
 * Edit rules:
 *  - TASK_UPDATE → may edit any field of tasks they can see;
 *  - assignee without TASK_UPDATE → may only move their own task through the workflow;
 *  - changing the assignee additionally needs TASK_ASSIGN.
 */
export async function updateTask(ctx, id, data) {
  const task = await findVisibleTask(ctx, id);
  const isAssignee = task.assignee?.id === ctx.membershipId;

  if (!ctx.can('TASK_UPDATE')) {
    const onlyStatus = Object.keys(data).every((k) => k === 'status');
    if (!isAssignee || !onlyStatus) {
      throw Errors.forbidden('You can only update the status of tasks assigned to you.');
    }
  }
  const assigneeChanged = data.assigneeId !== undefined && data.assigneeId !== (task.assignee?.id ?? null);
  if (assigneeChanged && !ctx.can('TASK_ASSIGN')) throw Errors.forbidden('You do not have permission to assign tasks.');

  const statusChanged = data.status && data.status !== task.status;
  const updated = await prisma.$transaction(async (tx) => {
    const assignee = assigneeChanged ? await prepareAssignee(tx, ctx, task.project.id, data.assigneeId) : null;
    const result = await tx.task.update({
      where: { id },
      data: {
        ...data,
        ...(statusChanged && { completedAt: data.status === 'COMPLETED' ? new Date() : null }),
      },
      include: taskInclude,
    });

    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'TASK', entityId: id, projectId: task.project.id };
    const title = result.title;
    if (statusChanged) {
      await logActivity(tx, {
        ...base,
        action: data.status === 'COMPLETED' ? ACTIONS.TASK_COMPLETED : ACTIONS.TASK_STATUS_CHANGED,
        metadata: { title, from: task.status, to: data.status },
      });
    }
    if (assigneeChanged) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_ASSIGNED, metadata: { title, assigneeName: assignee ? fullName(assignee.user) : null } });
    }
    const otherFields = Object.keys(data).filter((k) => k !== 'status' && k !== 'assigneeId');
    if (otherFields.length) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_UPDATED, metadata: { title, fields: otherFields } });
    }
    return result;
  });
  return present(updated);
}

export async function deleteTask(ctx, id) {
  const task = await findVisibleTask(ctx, id);
  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.TASK_DELETED,
      entityType: 'TASK',
      entityId: null,
      projectId: task.project.id,
      metadata: { title: task.title },
    });
  });
}

/**
 * CSV export (plan feature). Same visibility rules as the list. Cells that start with
 * = + - @ are prefixed so spreadsheet apps do not execute them as formulas (CSV injection).
 */
export async function exportTasksCsv(ctx, query) {
  await assertFeature(ctx.organizationId, FEATURES.DATA_EXPORT);
  const tasks = await prisma.task.findMany({
    where: buildListWhere(ctx, query),
    include: taskInclude,
    orderBy: [{ project: { name: 'asc' } }, { createdAt: 'asc' }],
    take: 5000,
  });
  const cell = (v) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = ['Project', 'Task', 'Status', 'Priority', 'Assignee', 'Due date', 'Completed at', 'Created at'];
  const rows = tasks.map((t) => [
    t.project.name, t.title, t.status, t.priority,
    t.assignee ? fullName(t.assignee.user) : '', t.dueDate, t.completedAt, t.createdAt,
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
