import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { fullName, paginate, startOfTodayUtc } from '../../common/utils/http.js';
import { assertCanCreateProject } from '../subscriptions/entitlement.service.js';
import { resolveActiveMembers } from '../users/member.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Visibility rule, used by every project/task query:
 *  - PROJECT_VIEW_ALL → every project of the organization;
 *  - otherwise → only projects where the caller is on the team.
 * Always combined with the caller's organizationId.
 */
export function visibleProjectsWhere(ctx) {
  const where = { organizationId: ctx.organizationId };
  if (!ctx.can('PROJECT_VIEW_ALL')) where.members = { some: { membershipId: ctx.membershipId } };
  return where;
}

const personSelect = { id: true, status: true, user: { select: { firstName: true, lastName: true } } };
const presentPerson = (m) => (m ? { id: m.id, name: fullName(m.user), status: m.status } : null);

const listInclude = {
  lead: { select: personSelect },
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

function present(project, stats) {
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
  return { items: items.map((p) => present(p, stats.get(p.id))), meta: meta(total) };
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
  return present(project, stats.get(id));
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
  return present(project);
}

export async function updateProject(ctx, id, data) {
  const current = await findVisibleProject(ctx, id);
  if (current.archivedAt) throw Errors.conflict('Restore this project before editing it.', 'PROJECT_ARCHIVED');
  assertDateOrder(data.startDate !== undefined ? data.startDate : current.startDate, data.dueDate !== undefined ? data.dueDate : current.dueDate);

  await prisma.$transaction(async (tx) => {
    if (data.name && data.name !== current.name) await assertNameAvailable(tx, ctx.organizationId, data.name, id);
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
      await logActivity(tx, { ...base, action: ACTIONS.PROJECT_STATUS_CHANGED, metadata: { name, from: current.status, to: data.status } });
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

export async function deleteProject(ctx, id) {
  const current = await findVisibleProject(ctx, id);
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } }); // tasks and team rows cascade
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.PROJECT_DELETED,
      entityType: 'PROJECT',
      entityId: null,
      metadata: { name: current.name },
    });
  });
}

export async function addProjectMembers(ctx, id, membershipIds) {
  const project = await findVisibleProject(ctx, id);
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
