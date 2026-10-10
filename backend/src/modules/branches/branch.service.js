import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { fullName } from '../../common/utils/http.js';
import { assertCanAddBranch } from '../subscriptions/entitlement.service.js';
import { resolveActiveMembers } from '../users/member.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Branches: parts of one organization (Head Office, Bole Branch …), never tenants of their own.
 *
 * Who may do what
 *  - BRANCH_MANAGE (Owner, Admin): create, edit, archive/reactivate, change the default, set managers, manage
 *    members of every branch. Also sees projects of every branch.
 *  - Branch manager: edit description/address and manage members of *their* branch only.
 *  - BRANCH_VIEW: list and open every branch. Without it, people see the branches they belong to or manage.
 * Rules
 *  - Every organization has exactly one default branch; it cannot be archived (make another branch default first).
 *  - Branches are archived (INACTIVE), never deleted. Archiving a branch with active projects requires choosing
 *    where they go (another active branch, or organization-wide); archived projects and members keep their link,
 *    so history stays intact.
 *  - Active branches count towards the plan's branch limit (shared by the whole organization).
 */

const managerSelect = { id: true, status: true, user: { select: { firstName: true, lastName: true } } };

const presentBranch = (b) => ({
  id: b.id,
  name: b.name,
  code: b.code,
  description: b.description,
  address: b.address,
  status: b.status,
  isDefault: b.isDefault,
  manager: b.manager ? { id: b.manager.id, name: fullName(b.manager.user), status: b.manager.status } : null,
  memberCount: b._count?.members ?? 0,
  activeProjectCount: b._count?.projects ?? 0,
  archivedAt: b.archivedAt,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

const counts = {
  _count: {
    select: {
      members: { where: { membership: { status: 'ACTIVE' } } },
      projects: { where: { archivedAt: null } },
    },
  },
};

const isManagerOf = (ctx, branch) => branch.managerId === ctx.membershipId;

/** Branches the caller may see: all with BRANCH_VIEW/BRANCH_MANAGE, else the ones they belong to or manage. */
function visibleBranchesWhere(ctx) {
  const where = { organizationId: ctx.organizationId };
  if (ctx.can('BRANCH_VIEW') || ctx.can('BRANCH_MANAGE')) return where;
  return { ...where, OR: [{ managerId: ctx.membershipId }, { members: { some: { membershipId: ctx.membershipId } } }] };
}

async function findBranch(ctx, id, db = prisma) {
  const branch = await db.branch.findFirst({ where: { id, ...visibleBranchesWhere(ctx) }, include: { manager: { select: managerSelect }, ...counts } });
  if (!branch) throw Errors.notFound('Branch');
  return branch;
}

/** Friendly message instead of a bare 409 when the name or code is already used in this organization. */
async function withUniqueNames(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const field = String(err.meta?.target ?? '').includes('code') ? 'code' : 'name';
      throw Errors.validation([{ field, message: `Another branch in your organization already uses this ${field}` }]);
    }
    throw err;
  }
}

/**
 * Validates a branch chosen for a project: same organization, active, and the caller works there
 * (or has BRANCH_MANAGE). Used by the project service.
 */
export async function assertBranchUsable(db, ctx, branchId) {
  const branch = await db.branch.findFirst({
    where: { id: branchId, organizationId: ctx.organizationId, status: 'ACTIVE' },
    select: { id: true, managerId: true, members: { where: { membershipId: ctx.membershipId }, select: { membershipId: true } } },
  });
  const allowed = branch && (ctx.can('BRANCH_MANAGE') || branch.managerId === ctx.membershipId || branch.members.length > 0);
  if (!allowed) throw Errors.validation([{ field: 'branchId', message: 'Choose an active branch you work in' }]);
}

export async function listBranches(ctx, query = {}) {
  const branches = await prisma.branch.findMany({
    where: {
      ...visibleBranchesWhere(ctx),
      ...(query.status && { status: query.status }),
      ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
    },
    include: { manager: { select: managerSelect }, ...counts },
    orderBy: [{ isDefault: 'desc' }, { status: 'asc' }, { name: 'asc' }],
  });
  return branches.map(presentBranch);
}

export async function getBranch(ctx, id) {
  const branch = await findBranch(ctx, id);
  const members = await prisma.branchMembership.findMany({
    where: { branchId: id, organizationId: ctx.organizationId },
    include: { membership: { include: { user: { select: { firstName: true, lastName: true, email: true } }, role: { select: { key: true, name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    ...presentBranch(branch),
    canManage: ctx.can('BRANCH_MANAGE') || isManagerOf(ctx, branch),
    members: members.map(({ membership: m, createdAt }) => ({
      membershipId: m.id,
      name: fullName(m.user),
      email: m.user.email,
      jobTitle: m.jobTitle,
      role: m.role,
      status: m.status,
      addedAt: createdAt,
    })),
  };
}

export async function createBranch(ctx, { managerId, ...fields }) {
  const branch = await prisma.$transaction(async (tx) => {
    await assertCanAddBranch(tx, ctx.organizationId);
    if (managerId) await resolveActiveMembers(tx, ctx.organizationId, [managerId], 'managerId');
    const created = await withUniqueNames(() =>
      tx.branch.create({ data: { ...fields, organizationId: ctx.organizationId, managerId: managerId ?? null } }),
    );
    // The manager works in the branch they manage.
    if (managerId) await tx.branchMembership.create({ data: { branchId: created.id, membershipId: managerId, organizationId: ctx.organizationId } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.BRANCH_CREATED,
      entityType: 'BRANCH',
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  });
  return getBranch(ctx, branch.id);
}

const MANAGER_EDITABLE = ['description', 'address'];

export async function updateBranch(ctx, id, data) {
  const { reassignProjectsTo, ...changes } = data;
  const branch = await findBranch(ctx, id);
  const canManageAll = ctx.can('BRANCH_MANAGE');
  if (!canManageAll) {
    const allowed = isManagerOf(ctx, branch) && Object.keys(changes).every((k) => MANAGER_EDITABLE.includes(k)) && reassignProjectsTo === undefined;
    if (!allowed) throw Errors.forbidden(isManagerOf(ctx, branch) ? 'Branch managers can change the description and address only.' : undefined);
  }

  const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'BRANCH', entityId: id };
  await prisma.$transaction(async (tx) => {
    const { status, isDefault, managerId, ...fields } = changes;

    if (managerId !== undefined && managerId !== branch.managerId) {
      if (managerId) {
        await resolveActiveMembers(tx, ctx.organizationId, [managerId], 'managerId');
        await tx.branchMembership.upsert({
          where: { branchId_membershipId: { branchId: id, membershipId: managerId } },
          update: {},
          create: { branchId: id, membershipId: managerId, organizationId: ctx.organizationId },
        });
      }
      fields.managerId = managerId;
    }

    if (status === 'INACTIVE' && branch.status === 'ACTIVE') {
      if (branch.isDefault) {
        throw Errors.conflict('The default branch cannot be archived. Make another branch the default first.', 'DEFAULT_BRANCH_REQUIRED');
      }
      const activeProjects = await tx.project.count({ where: { branchId: id, archivedAt: null } });
      let movedTo = null;
      if (activeProjects > 0) {
        if (reassignProjectsTo === undefined) {
          throw Errors.conflict(
            `This branch has ${activeProjects} active project(s). Choose another branch or "organization-wide" for them before archiving.`,
            'BRANCH_HAS_ACTIVE_PROJECTS',
          );
        }
        if (reassignProjectsTo) {
          if (reassignProjectsTo === id) throw Errors.validation([{ field: 'reassignProjectsTo', message: 'Choose a different branch' }]);
          const target = await tx.branch.findFirst({ where: { id: reassignProjectsTo, organizationId: ctx.organizationId, status: 'ACTIVE' } });
          if (!target) throw Errors.validation([{ field: 'reassignProjectsTo', message: 'Choose an active branch of your organization' }]);
          movedTo = target.name;
        }
        await tx.project.updateMany({ where: { branchId: id, archivedAt: null }, data: { branchId: reassignProjectsTo } });
      }
      fields.status = 'INACTIVE';
      fields.archivedAt = new Date();
      await logActivity(tx, { ...base, action: ACTIONS.BRANCH_ARCHIVED, metadata: { name: branch.name, movedProjects: activeProjects, movedTo: movedTo ?? 'organization-wide' } });
    } else if (status === 'ACTIVE' && branch.status === 'INACTIVE') {
      await assertCanAddBranch(tx, ctx.organizationId);
      fields.status = 'ACTIVE';
      fields.archivedAt = null;
      await logActivity(tx, { ...base, action: ACTIONS.BRANCH_REACTIVATED, metadata: { name: branch.name } });
    }

    if (isDefault && !branch.isDefault) {
      if ((fields.status ?? branch.status) !== 'ACTIVE') throw Errors.conflict('Only an active branch can be the default.', 'BRANCH_INACTIVE');
      await tx.branch.updateMany({ where: { organizationId: ctx.organizationId, isDefault: true }, data: { isDefault: false } });
      fields.isDefault = true;
      await logActivity(tx, { ...base, action: ACTIONS.BRANCH_DEFAULT_CHANGED, metadata: { name: fields.name ?? branch.name } });
    }

    const edited = Object.keys(fields).filter((k) => !['status', 'archivedAt', 'isDefault'].includes(k));
    await withUniqueNames(() => tx.branch.update({ where: { id }, data: fields }));
    if (edited.length) await logActivity(tx, { ...base, action: ACTIONS.BRANCH_UPDATED, metadata: { name: fields.name ?? branch.name, fields: edited } });
  });
  return getBranch(ctx, id);
}

function assertCanManageMembers(ctx, branch) {
  if (!ctx.can('BRANCH_MANAGE') && !isManagerOf(ctx, branch)) throw Errors.forbidden();
  if (branch.status !== 'ACTIVE') throw Errors.conflict('Reactivate this branch before changing its members.', 'BRANCH_INACTIVE');
}

export async function addBranchMembers(ctx, id, membershipIds) {
  const branch = await findBranch(ctx, id);
  assertCanManageMembers(ctx, branch);
  await prisma.$transaction(async (tx) => {
    // Only active members of this organization (another tenant's id is rejected like an unknown one).
    const members = await resolveActiveMembers(tx, ctx.organizationId, membershipIds, 'membershipIds');
    const { count } = await tx.branchMembership.createMany({
      data: members.map((m) => ({ branchId: id, membershipId: m.id, organizationId: ctx.organizationId })),
      skipDuplicates: true,
    });
    if (count) {
      await logActivity(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.membershipId,
        action: ACTIONS.BRANCH_MEMBER_ADDED,
        entityType: 'BRANCH',
        entityId: id,
        metadata: { name: branch.name, memberNames: members.map((m) => fullName(m.user)).join(', ') },
      });
    }
  });
  return getBranch(ctx, id);
}

export async function removeBranchMember(ctx, id, membershipId) {
  const branch = await findBranch(ctx, id);
  assertCanManageMembers(ctx, branch);
  if (branch.managerId === membershipId) {
    throw Errors.conflict('This person manages the branch. Assign another manager first.', 'BRANCH_MANAGER_REQUIRED');
  }
  const link = await prisma.branchMembership.findFirst({
    where: { branchId: id, membershipId, organizationId: ctx.organizationId },
    include: { membership: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });
  if (!link) throw Errors.notFound('Branch member');
  await prisma.$transaction(async (tx) => {
    await tx.branchMembership.delete({ where: { branchId_membershipId: { branchId: id, membershipId } } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.BRANCH_MEMBER_REMOVED,
      entityType: 'BRANCH',
      entityId: id,
      metadata: { name: branch.name, memberName: fullName(link.membership.user) },
    });
  });
  return getBranch(ctx, id);
}
