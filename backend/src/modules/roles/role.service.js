import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { OWNER_ROLE_KEY, PERMISSION_CATALOG, SYSTEM_ROLES, OWNER_ONLY_PERMISSIONS } from '../../common/constants/permissions.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

const permissionIdMap = async (db) =>
  new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));

/** Creates the default Owner/Admin/Manager/Employee roles for a new organization. */
export async function createSystemRoles(tx, organizationId) {
  const ids = await permissionIdMap(tx);
  const roles = {};
  for (const def of SYSTEM_ROLES) {
    roles[def.key] = await tx.role.create({
      data: {
        organizationId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        permissions: { create: def.permissions.map((key) => ({ permissionId: ids.get(key) })) },
      },
    });
  }
  return roles;
}

const roleInclude = {
  permissions: { include: { permission: { select: { key: true } } } },
  _count: { select: { memberships: { where: { status: { in: ['ACTIVE', 'INVITED'] } } } } },
};

const present = (role) => ({
  id: role.id,
  key: role.key,
  name: role.name,
  description: role.description,
  isSystem: role.isSystem,
  isLocked: role.key === OWNER_ROLE_KEY,
  permissions: role.permissions.map((rp) => rp.permission.key).sort(),
  memberCount: role._count?.memberships ?? 0,
});

/**
 * Privilege-escalation guard: nobody can create, edit or hand out a role carrying a
 * permission they do not hold themselves. Owners hold every permission, so they are never blocked.
 */
export function assertWithinOwnPermissions(ctx, permissionKeys) {
  if (permissionKeys.some((p) => !ctx.can(p))) {
    throw Errors.forbidden('You cannot grant permissions you do not have yourself.', 'PRIVILEGE_ESCALATION');
  }
}

/** Owner-only permissions (e.g. permanent project deletion) can't be put in any other role. */
function assertNoOwnerOnly(permissionKeys) {
  const reserved = permissionKeys.filter((p) => OWNER_ONLY_PERMISSIONS.includes(p));
  if (reserved.length) {
    throw Errors.validation([{ field: 'permissions', message: `Only the Owner role can hold: ${reserved.join(', ')}` }]);
  }
}

export async function listRoles(ctx) {
  const roles = await prisma.role.findMany({
    where: { organizationId: ctx.organizationId },
    include: roleInclude,
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
  });
  return roles.map(present);
}

export const listPermissionCatalog = () =>
  PERMISSION_CATALOG.map(({ key, group, label, description }) => ({ key, group, label, description, ownerOnly: OWNER_ONLY_PERMISSIONS.includes(key) }));

async function findRole(ctx, id) {
  const role = await prisma.role.findFirst({ where: { id, organizationId: ctx.organizationId }, include: roleInclude });
  if (!role) throw Errors.notFound('Role');
  return role;
}

async function assertNameFree(tx, organizationId, name, exceptId) {
  const clash = await tx.role.findFirst({
    where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) },
  });
  if (clash) throw Errors.conflict(`A role named "${name}" already exists.`, 'ROLE_NAME_TAKEN');
}

export async function createRole(ctx, { name, description, permissions }) {
  assertWithinOwnPermissions(ctx, permissions);
  assertNoOwnerOnly(permissions);
  const ids = await permissionIdMap(prisma);

  const role = await prisma.$transaction(async (tx) => {
    await assertNameFree(tx, ctx.organizationId, name);
    const created = await tx.role.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        description,
        permissions: { create: permissions.map((key) => ({ permissionId: ids.get(key) })) },
      },
      include: roleInclude,
    });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.ROLE_CREATED,
      entityType: 'ROLE',
      entityId: created.id,
      metadata: { name },
    });
    return created;
  });
  return present(role);
}

export async function updateRole(ctx, id, { name, description, permissions }) {
  const role = await findRole(ctx, id);
  if (role.key === OWNER_ROLE_KEY) {
    throw Errors.forbidden('The Owner role always has full access and cannot be changed.', 'ROLE_LOCKED');
  }
  if (role.isSystem && name && name !== role.name) {
    throw Errors.badRequest('Default roles cannot be renamed.');
  }
  // Changing a role grants its permissions to everyone holding it.
  if (permissions) {
    assertWithinOwnPermissions(ctx, permissions);
    assertNoOwnerOnly(permissions);
  }
  const ids = await permissionIdMap(prisma);

  const updated = await prisma.$transaction(async (tx) => {
    if (name && name !== role.name) await assertNameFree(tx, ctx.organizationId, name, id);
    if (permissions) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: permissions.map((key) => ({ roleId: id, permissionId: ids.get(key) })) });
    }
    const result = await tx.role.update({
      where: { id },
      data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }) },
      include: roleInclude,
    });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.ROLE_UPDATED,
      entityType: 'ROLE',
      entityId: id,
      metadata: { name: result.name },
    });
    return result;
  });
  return present(updated);
}

export async function deleteRole(ctx, id) {
  const role = await findRole(ctx, id);
  if (role.isSystem) throw Errors.forbidden('Default roles cannot be deleted.', 'ROLE_LOCKED');

  const assigned = await prisma.membership.count({ where: { roleId: id, organizationId: ctx.organizationId } });
  if (assigned > 0) {
    throw Errors.conflict(
      `This role is still assigned to ${assigned} member(s). Move them to another role first.`,
      'ROLE_IN_USE',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.ROLE_DELETED,
      entityType: 'ROLE',
      entityId: id,
      metadata: { name: role.name },
    });
  });
}
