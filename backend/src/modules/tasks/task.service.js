import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { FEATURES } from '../../common/constants/plans.js';
import { addDays, fullName, paginate, stableOrder, startOfTodayUtc } from '../../common/utils/http.js';
import { assertFeature } from '../subscriptions/entitlement.service.js';
import { resolveActiveMembers } from '../users/member.service.js';
import { assertCanManageProject, canManageProject, visibleProjectsWhere } from '../projects/project.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';
import { notify, projectResponsible } from '../notifications/notification.service.js';

/**
 * A task is visible when its project is visible to the caller, or when it is assigned to them
 * (so people keep seeing their own work even after leaving a project team).
 * Tasks of archived projects are excluded from active views (My Work, dashboard, default lists); they are
 * readable as history only when asked for explicitly (`includeArchived`), and can't be changed (D-11).
 */
export function visibleTasksWhere(ctx, { includeArchived = false } = {}) {
  const { organizationId, ...projectFilter } = visibleProjectsWhere(ctx);
  return {
    organizationId,
    ...(!includeArchived && { project: { archivedAt: null } }),
    ...(Object.keys(projectFilter).length && {
      OR: [{ project: projectFilter }, { assigneeId: ctx.membershipId }],
    }),
  };
}

/** Includes what `present` needs, incl. the management-scope facts about the caller (only their own team row). */
const taskIncludeFor = (ctx) => ({
  project: {
    select: {
      id: true,
      name: true,
      archivedAt: true,
      leadId: true,
      createdById: true,
      branch: { select: { managerId: true } },
      members: { where: { membershipId: ctx.membershipId }, select: { membershipId: true } },
    },
  },
  assignee: { select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } } },
  createdBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
});

const present = (t, ctx) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate,
  completedAt: t.completedAt,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  project: { id: t.project.id, name: t.project.name, archived: !!t.project.archivedAt },
  // May the caller manage this task's project (D-3)? The server enforces it; the UI uses it to show actions.
  inScope: ctx ? canManageProject(ctx, t.project) : false,
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
  // One project's list (its page) or an explicit request includes archived projects' tasks, read-only.
  const and = [visibleTasksWhere(ctx, { includeArchived: !!q.projectId || q.includeArchived }), dueFilter(q.due)];
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
    prisma.task.findMany({ where, include: taskIncludeFor(ctx), orderBy: stableOrder(SORTS[query.sort](query.order)), skip, take }),
    prisma.task.count({ where }),
  ]);
  return { items: items.map((t) => present(t, ctx)), meta: meta(total) };
}

/** The caller's own work, bucketed the way people plan their day. */
export async function myWork(ctx) {
  const today = startOfTodayUtc();
  const mine = { ...visibleTasksWhere(ctx), assigneeId: ctx.membershipId };
  const open = { ...mine, status: { not: 'COMPLETED' } };
  const query = (where, orderBy, take = 50) => prisma.task.findMany({ where, include: taskIncludeFor(ctx), orderBy, take });

  const [overdue, dueToday, upcoming, noDate, completed] = await Promise.all([
    query({ ...open, dueDate: { lt: today } }, [{ dueDate: 'asc' }]),
    query({ ...open, dueDate: today }, [{ priority: 'desc' }]),
    query({ ...open, dueDate: { gt: today } }, [{ dueDate: 'asc' }]),
    query({ ...open, dueDate: null }, [{ priority: 'desc' }, { createdAt: 'desc' }]),
    query({ ...mine, status: 'COMPLETED', completedAt: { gte: addDays(today, -14) } }, [{ completedAt: 'desc' }], 20),
  ]);
  return {
    overdue: overdue.map((t) => present(t, ctx)),
    today: dueToday.map((t) => present(t, ctx)),
    upcoming: [...upcoming, ...noDate].map((t) => present(t, ctx)),
    completed: completed.map((t) => present(t, ctx)),
  };
}

async function findVisibleTask(ctx, id) {
  const task = await prisma.task.findFirst({ where: { id, ...visibleTasksWhere(ctx, { includeArchived: true }) }, include: taskIncludeFor(ctx) });
  if (!task) throw Errors.notFound('Task');
  return task;
}

export const getTask = async (ctx, id) => present(await findVisibleTask(ctx, id), ctx);

const archivedProject = () => Errors.conflict('This project is archived. Its tasks are read-only until it is restored.', 'PROJECT_ARCHIVED');

/** The project with what the management-scope rule needs (lead, creator, team, branch manager). */
const projectForScope = (db, projectId) =>
  db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, archivedAt: true, leadId: true, createdById: true, branch: { select: { managerId: true } }, members: { select: { membershipId: true } } },
  });

/**
 * D-12: an assignee must be an active member of this organization AND already on the project's team —
 * collaboration across branches is fine, but only through explicit project membership.
 */
async function validateAssignee(tx, ctx, project, assigneeId) {
  if (!assigneeId) return null;
  const [member] = await resolveActiveMembers(tx, ctx.organizationId, [assigneeId], 'assigneeId');
  if (!project.members.some((m) => m.membershipId === assigneeId)) {
    throw Errors.validation([{ field: 'assigneeId', message: 'Add this person to the project team first' }]);
  }
  return member;
}

/** The new assignee hears about it (unless they assigned themselves). */
const notifyAssigned = (tx, ctx, task, project) =>
  notify(tx, {
    organizationId: ctx.organizationId, recipients: [task.assigneeId], actorId: ctx.membershipId, type: 'TASK_ASSIGNED',
    title: 'New task assigned', message: `${fullName(ctx.user)} assigned you “${task.title}” in ${project.name}.`,
    link: `/my-work?task=${task.id}`, entityType: 'TASK', entityId: task.id,
  });

export async function createTask(ctx, data) {
  const visible = await prisma.project.findFirst({ where: { id: data.projectId, ...visibleProjectsWhere(ctx) }, select: { id: true } });
  if (!visible) throw Errors.validation([{ field: 'projectId', message: 'Select a project you have access to' }]);
  const project = await projectForScope(prisma, visible.id);
  if (project.archivedAt) throw Errors.conflict('This project is archived. Restore it to add tasks.', 'PROJECT_ARCHIVED');
  assertCanManageProject(ctx, project); // D-3/D-6: only in projects they manage or are on
  if (data.assigneeId && !ctx.can('TASK_ASSIGN')) throw Errors.forbidden('You do not have permission to assign tasks.');

  const task = await prisma.$transaction(async (tx) => {
    const assignee = await validateAssignee(tx, ctx, project, data.assigneeId);
    const created = await tx.task.create({
      data: {
        ...data,
        organizationId: ctx.organizationId,
        createdById: ctx.membershipId,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      },
      include: taskIncludeFor(ctx),
    });
    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'TASK', entityId: created.id, projectId: project.id };
    await logActivity(tx, { ...base, action: ACTIONS.TASK_CREATED, metadata: { title: created.title, projectName: project.name } });
    if (assignee) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_ASSIGNED, metadata: { title: created.title, assigneeName: fullName(assignee.user) } });
      await notifyAssigned(tx, ctx, created, project);
    }
    return created;
  });
  return present(task, ctx);
}

/**
 * Edit rules:
 *  - TASK_UPDATE → may edit any field of tasks they can see;
 *  - assignee without TASK_UPDATE → may only move their own task through the workflow;
 *  - changing the assignee additionally needs TASK_ASSIGN.
 */
export async function updateTask(ctx, id, data) {
  const task = await findVisibleTask(ctx, id);
  if (task.project.archivedAt) throw archivedProject();
  const isAssignee = task.assignee?.id === ctx.membershipId;
  const onlyStatus = Object.keys(data).every((k) => k === 'status');
  const project = await projectForScope(prisma, task.project.id);

  // The assignee may always move their own task; anything else needs TASK_UPDATE in a project they manage.
  if (!(isAssignee && onlyStatus)) {
    if (!ctx.can('TASK_UPDATE')) throw Errors.forbidden('You can only update the status of tasks assigned to you.');
    assertCanManageProject(ctx, project);
  }
  const assigneeChanged = data.assigneeId !== undefined && data.assigneeId !== (task.assignee?.id ?? null);
  if (assigneeChanged && !ctx.can('TASK_ASSIGN')) throw Errors.forbidden('You do not have permission to assign tasks.');

  const statusChanged = data.status && data.status !== task.status;
  const reopened = statusChanged && task.status === 'COMPLETED';
  const updated = await prisma.$transaction(async (tx) => {
    const assignee = assigneeChanged ? await validateAssignee(tx, ctx, project, data.assigneeId) : null;
    const result = await tx.task.update({
      where: { id },
      data: {
        ...data,
        ...(statusChanged && { completedAt: data.status === 'COMPLETED' ? new Date() : null }),
      },
      include: taskIncludeFor(ctx),
    });

    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'TASK', entityId: id, projectId: task.project.id };
    const title = result.title;
    if (statusChanged) {
      await logActivity(tx, {
        ...base,
        action: data.status === 'COMPLETED' ? ACTIONS.TASK_COMPLETED : reopened ? ACTIONS.TASK_REOPENED : ACTIONS.TASK_STATUS_CHANGED,
        metadata: { title, from: task.status, to: data.status },
      });
    }
    if (assigneeChanged) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_ASSIGNED, metadata: { title, assigneeName: assignee ? fullName(assignee.user) : null } });
      if (assignee) await notifyAssigned(tx, ctx, result, project);
      if (task.assignee) {
        await notify(tx, {
          organizationId: ctx.organizationId, recipients: [task.assignee.id], actorId: ctx.membershipId, type: 'TASK_UNASSIGNED',
          title: 'Task reassigned', message: `${fullName(ctx.user)} moved “${title}” in ${project.name} to ${assignee ? fullName(assignee.user) : 'no one'}.`,
          link: `/projects/${project.id}`, entityType: 'PROJECT', entityId: project.id,
        });
      }
    }
    if (statusChanged && data.status === 'COMPLETED') {
      await notify(tx, {
        organizationId: ctx.organizationId, recipients: [projectResponsible(project)], actorId: ctx.membershipId, type: 'TASK_COMPLETED',
        title: 'Task completed', message: `${fullName(ctx.user)} completed “${title}” in ${project.name}.`,
        link: `/projects/${project.id}?task=${id}`, entityType: 'TASK', entityId: id,
      });
    }
    const otherFields = Object.keys(data).filter((k) => k !== 'status' && k !== 'assigneeId');
    if (otherFields.length) {
      await logActivity(tx, { ...base, action: ACTIONS.TASK_UPDATED, metadata: { title, fields: otherFields } });
    }
    return result;
  });
  return present(updated, ctx);
}

/** D-2: permanent deletion (Owner/Admin by default) — only in projects the person manages, never archived ones. */
export async function deleteTask(ctx, id) {
  const task = await findVisibleTask(ctx, id);
  if (task.project.archivedAt) throw archivedProject();
  assertCanManageProject(ctx, await projectForScope(prisma, task.project.id));
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
    include: taskIncludeFor(ctx),
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
