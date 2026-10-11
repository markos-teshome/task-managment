import { prisma } from '../../lib/prisma.js';
import { AppError, Errors } from '../../common/errors/AppError.js';
import { fullName, paginate, startOfTodayUtc } from '../../common/utils/http.js';
import { assertCanCreateProject } from '../subscriptions/entitlement.service.js';
import { resolveActiveMembers } from '../users/member.service.js';
import { assertBranchUsable } from '../branches/branch.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Visibility rule, used by every project/task/activity query (tasks inherit it from their project):
 *  - PROJECT_VIEW_ALL + BRANCH_MANAGE → every project of the organization;
 *  - PROJECT_VIEW_ALL → organization-wide projects, projects of branches the caller belongs to or manages,
 *    and projects whose team they are on;
 *  - otherwise → only projects whose team the caller is on (wherever the project lives).
 * Always combined with the caller's organizationId. The scope sits under AND so a caller's own filters
 * (e.g. a search OR) can never replace it.
 */
export function visibleProjectsWhere(ctx) {
  const onTeam = { members: { some: { membershipId: ctx.membershipId } } };
  let scope = null;
  if (!ctx.can('PROJECT_VIEW_ALL')) scope = onTeam;
  else if (!ctx.can('BRANCH_MANAGE')) {
    scope = {
      OR: [
        { branchId: null },
        { branch: { members: { some: { membershipId: ctx.membershipId } } } },
        { branch: { managerId: ctx.membershipId } },
        onTeam,
      ],
    };
  }
  return { organizationId: ctx.organizationId, ...(scope && { AND: [scope] }) };
}

/**
 * Management scope (D-3): who may change a project and run its tasks. Seeing a project is not enough:
 * PROJECT_MANAGE_ALL (Owner, Admin), or being the project's lead, creator, a team member, or the manager of
 * its branch. Combined with the specific permission (PROJECT_UPDATE, TASK_CREATE …) by the callers.
 */
export function canManageProject(ctx, project) {
  if (ctx.can('PROJECT_MANAGE_ALL')) return true;
  const me = ctx.membershipId;
  return (
    project.leadId === me ||
    project.createdById === me ||
    (project.members ?? []).some((m) => (m.membership?.id ?? m.membershipId) === me) ||
    project.branch?.managerId === me
  );
}

export function assertCanManageProject(ctx, project) {
  if (!canManageProject(ctx, project)) {
    throw Errors.forbidden('You can view this project but not manage it. Ask its lead or an admin.', 'PROJECT_NOT_MANAGED');
  }
}

const personSelect = { id: true, status: true, user: { select: { firstName: true, lastName: true } } };
const presentPerson = (m) => (m ? { id: m.id, name: fullName(m.user), status: m.status } : null);

const listInclude = {
  lead: { select: personSelect },
  branch: { select: { id: true, name: true, status: true, managerId: true } },
  members: { select: { membership: { select: personSelect } }, orderBy: { createdAt: 'asc' } },
};

/** Task counts per project in one grouped query (no N+1). */
async function taskStats(projectIds) {
  if (!projectIds.length) return new Map();
  const groups = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: { projectId: { in: projectIds } },
    _count: { _all: true },
  });
  const overdue = await prisma.task.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds }, status: { not: 'COMPLETED' }, dueDate: { lt: startOfTodayUtc() } },
    _count: { _all: true },
  });
  const stats = new Map(projectIds.map((pid) => [pid, { total: 0, completed: 0, inProgress: 0, blocked: 0, overdue: 0 }]));
  for (const g of groups) {
    const s = stats.get(g.projectId);
    s.total += g._count._all;
    if (g.status === 'COMPLETED') s.completed += g._count._all;
    if (g.status === 'IN_PROGRESS') s.inProgress += g._count._all;
    if (g.status === 'BLOCKED') s.blocked += g._count._all;
  }
  for (const o of overdue) stats.get(o.projectId).overdue = o._count._all;
  for (const s of stats.values()) s.progress = s.total ? Math.round((s.completed / s.total) * 100) : 0;
  return stats;
}

function present(project, stats, ctx) {
  const { managerId: _managerId, ...branch } = project.branch ?? {};
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    dueDate: project.dueDate,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lead: presentPerson(project.lead),
    branch: project.branch ? branch : null, // null = organization-wide
    // What the caller may do here (the server enforces the same rules).
    inScope: ctx ? canManageProject(ctx, project) : false, // may run its tasks (with the task permissions)
    canManage: ctx ? canManageProject(ctx, project) && ctx.can('PROJECT_UPDATE') : false,
    members: project.members.map((pm) => presentPerson(pm.membership)),
    stats: stats ?? { total: 0, completed: 0, inProgress: 0, blocked: 0, overdue: 0, progress: 0 },
  };
}

const SORTS = {
  name: (dir) => ({ name: dir }),
  dueDate: (dir) => ({ dueDate: { sort: dir, nulls: 'last' } }),
  createdAt: (dir) => ({ createdAt: dir }),
  priority: (dir) => ({ priority: dir }),
  status: (dir) => ({ status: dir }),
};

export async function listProjects(ctx, query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...visibleProjectsWhere(ctx),
    archivedAt: query.archived ? { not: null } : null,
    ...(query.status && { status: query.status }),
    ...(query.openOnly && !query.status && { status: { notIn: ['COMPLETED', 'CANCELLED'] } }),
    ...(query.priority && { priority: query.priority }),
    ...(query.leadId && { leadId: query.leadId }),
    ...(query.branchId && { branchId: query.branchId === 'none' ? null : query.branchId }),
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.project.findMany({ where, include: listInclude, orderBy: SORTS[query.sort](query.order), skip, take }),
    prisma.project.count({ where }),
  ]);
  const stats = await taskStats(items.map((p) => p.id));
  return { items: items.map((p) => present(p, stats.get(p.id), ctx)), meta: meta(total) };
}

/** Loads a project the caller may see, or 404 — also for other tenants' ids. */
export async function findVisibleProject(ctx, id, db = prisma) {
  const project = await db.project.findFirst({ where: { id, ...visibleProjectsWhere(ctx) }, include: listInclude });
  if (!project) throw Errors.notFound('Project');
  return project;
}

export async function getProject(ctx, id) {
  const project = await findVisibleProject(ctx, id);
  const stats = await taskStats([id]);
  return present(project, stats.get(id), ctx);
}

async function assertNameAvailable(db, organizationId, name, exceptId) {
  const clash = await db.project.findFirst({
    where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) },
    select: { id: true },
  });
  if (clash) throw Errors.conflict(`A project named "${name}" already exists in your organization.`, 'PROJECT_NAME_TAKEN');
}

function assertDateOrder(startDate, dueDate) {
  if (startDate && dueDate && dueDate < startDate) {
    throw Errors.validation([{ field: 'dueDate', message: 'Due date cannot be before the start date' }]);
  }
}

export async function createProject(ctx, data) {
  const { memberIds = [], ...fields } = data;
  assertDateOrder(fields.startDate, fields.dueDate);

  const project = await prisma.$transaction(async (tx) => {
    await assertCanCreateProject(tx, ctx.organizationId);
    await assertNameAvailable(tx, ctx.organizationId, fields.name);
    if (fields.branchId) await assertBranchUsable(tx, ctx, fields.branchId);

    // Team = chosen members + the lead + the creator when they could not otherwise see it.
    const teamIds = new Set(memberIds);
    if (fields.leadId) teamIds.add(fields.leadId);
    if (!ctx.can('PROJECT_VIEW_ALL')) teamIds.add(ctx.membershipId);
    await resolveActiveMembers(tx, ctx.organizationId, [...teamIds]);

    const created = await tx.project.create({
      data: {
        ...fields,
        organizationId: ctx.organizationId,
        createdById: ctx.membershipId,
        members: { create: [...teamIds].map((membershipId) => ({ membershipId })) },
      },
      include: listInclude,
    });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.PROJECT_CREATED,
      entityType: 'PROJECT',
      entityId: created.id,
      projectId: created.id,
      metadata: { name: created.name },
    });
    return created;
  });
  return present(project, undefined, ctx);
}

export async function updateProject(ctx, id, input) {
  const { confirmOpenTasks, ...data } = input;
  const current = await findVisibleProject(ctx, id);
  assertCanManageProject(ctx, current);
  if (current.archivedAt) throw Errors.conflict('Restore this project before editing it.', 'PROJECT_ARCHIVED');

  // D-4: completing with unfinished tasks needs an explicit, recorded confirmation; tasks stay untouched.
  let openTasks = 0;
  if (data.status === 'COMPLETED' && current.status !== 'COMPLETED') {
    openTasks = await prisma.task.count({ where: { projectId: id, status: { not: 'COMPLETED' } } });
    if (openTasks > 0 && !confirmOpenTasks) {
      throw new AppError(409, 'PROJECT_HAS_OPEN_TASKS', `This project still has ${openTasks} unfinished task(s). Confirm to complete it anyway — the tasks stay as they are.`, [{ field: 'openTasks', message: String(openTasks) }]);
    }
  }
  assertDateOrder(data.startDate !== undefined ? data.startDate : current.startDate, data.dueDate !== undefined ? data.dueDate : current.dueDate);

  await prisma.$transaction(async (tx) => {
    if (data.name && data.name !== current.name) await assertNameAvailable(tx, ctx.organizationId, data.name, id);
    if (data.branchId && data.branchId !== current.branchId) await assertBranchUsable(tx, ctx, data.branchId);
    if (data.leadId) {
      await resolveActiveMembers(tx, ctx.organizationId, [data.leadId], 'leadId');
      await tx.projectMember.upsert({
        where: { projectId_membershipId: { projectId: id, membershipId: data.leadId } },
        update: {},
        create: { projectId: id, membershipId: data.leadId, organizationId: ctx.organizationId },
      });
    }
    await tx.project.update({ where: { id }, data });

    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'PROJECT', entityId: id, projectId: id };
    const name = data.name ?? current.name;
    if (data.status && data.status !== current.status) {
      await logActivity(tx, { ...base, action: ACTIONS.PROJECT_STATUS_CHANGED, metadata: { name, from: current.status, to: data.status, ...(openTasks && { openTasks }) } });
    }
    const otherChanges = Object.keys(data).filter((k) => k !== 'status');
    if (otherChanges.length) {
      await logActivity(tx, { ...base, action: ACTIONS.PROJECT_UPDATED, metadata: { name, fields: otherChanges } });
    }
  });
  return getProject(ctx, id);
}

export async function setArchived(ctx, id, archived) {
  const current = await findVisibleProject(ctx, id);
  assertCanManageProject(ctx, current);
  if (!!current.archivedAt === archived) return getProject(ctx, id);

  await prisma.$transaction(async (tx) => {
    // Restoring brings the project back into the active-project quota.
    if (!archived) await assertCanCreateProject(tx, ctx.organizationId);
    await tx.project.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: archived ? ACTIONS.PROJECT_ARCHIVED : ACTIONS.PROJECT_RESTORED,
      entityType: 'PROJECT',
      entityId: id,
      projectId: id,
      metadata: { name: current.name },
    });
  });
  return getProject(ctx, id);
}

/**
 * D-1: permanent deletion is the Owner's decision, only for an archived project, confirmed by typing its name.
 * Tasks and team rows go with it; the company history keeps the record (name, task count, who, when).
 */
export async function deleteProject(ctx, id, { confirmName } = {}) {
  if (!ctx.isOwner) throw Errors.forbidden('Only an owner can permanently delete a project. Archive it instead.', 'OWNER_ONLY');
  const current = await findVisibleProject(ctx, id);
  if (!current.archivedAt) throw Errors.conflict('Archive the project before deleting it permanently.', 'PROJECT_NOT_ARCHIVED');
  if ((confirmName ?? '').trim() !== current.name) {
    throw Errors.validation([{ field: 'confirmName', message: 'Type the project name exactly to confirm' }]);
  }
  await prisma.$transaction(async (tx) => {
    const taskCount = await tx.task.count({ where: { projectId: id } });
    await tx.project.delete({ where: { id } }); // tasks and team rows cascade
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.PROJECT_DELETED,
      entityType: 'PROJECT',
      entityId: null,
      metadata: { name: current.name, taskCount },
    });
  });
}

export async function addProjectMembers(ctx, id, membershipIds) {
  const project = await findVisibleProject(ctx, id);
  assertCanManageProject(ctx, project);
  if (project.archivedAt) throw Errors.conflict('Restore this project before changing its team.', 'PROJECT_ARCHIVED');
  const existing = new Set(project.members.map((m) => m.membership.id));
  const toAdd = (await resolveActiveMembers(prisma, ctx.organizationId, membershipIds)).filter((m) => !existing.has(m.id));

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.createMany({
      data: toAdd.map((m) => ({ projectId: id, membershipId: m.id, organizationId: ctx.organizationId })),
      skipDuplicates: true,
    });
    for (const m of toAdd) {
      await logActivity(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.membershipId,
        action: ACTIONS.PROJECT_MEMBER_ADDED,
        entityType: 'PROJECT',
        entityId: id,
        projectId: id,
        metadata: { memberName: fullName(m.user), projectName: project.name },
      });
    }
  });
  return getProject(ctx, id);
}

export async function removeProjectMember(ctx, id, membershipId) {
  const project = await findVisibleProject(ctx, id);
  assertCanManageProject(ctx, project);
  if (project.archivedAt) throw Errors.conflict('Restore this project before changing its team.', 'PROJECT_ARCHIVED');
  const member = project.members.find((m) => m.membership.id === membershipId)?.membership;
  if (!member) throw Errors.notFound('Team member');
  if (project.lead?.id === membershipId) {
    throw Errors.conflict('This person leads the project. Choose a different lead first.', 'PROJECT_LEAD');
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { projectId_membershipId: { projectId: id, membershipId } } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.PROJECT_MEMBER_REMOVED,
      entityType: 'PROJECT',
      entityId: id,
      projectId: id,
      metadata: { memberName: fullName(member.user), projectName: project.name },
    });
  });
  return getProject(ctx, id);
}
