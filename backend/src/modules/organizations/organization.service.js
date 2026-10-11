import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { DEFAULT_BRANCH_NAME, FREE_PLAN_CODE } from '../../common/constants/plans.js';
import { randomToken, verifyPassword } from '../../common/utils/crypto.js';
import { fullName, slugify } from '../../common/utils/http.js';
import { createSystemRoles } from '../roles/role.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';
import { getEntitlementSummary, isSubscriptionLive, lockOrganization } from '../subscriptions/entitlement.service.js';
import { OWNER_ROLE_KEY } from '../../common/constants/permissions.js';
import { releaseDuties } from '../users/member.service.js';

async function uniqueSlug(tx, name) {
  const base = slugify(name);
  if (!(await tx.organization.findUnique({ where: { slug: base } }))) return base;
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)}`;
}

/**
 * Creates a tenant atomically: organization, default roles, the creator as Owner, its default branch,
 * a Free subscription and the audit entry. Either all of it exists or none of it does.
 * The same person can own several organizations; their user account is never duplicated.
 */
export async function createOrganization(userId, { name }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.emailVerifiedAt) throw Errors.forbidden('Verify your email before creating an organization.', 'EMAIL_NOT_VERIFIED');

  // Names are not globally unique (two companies may share one, and saying "taken" would reveal that
  // another tenant exists), but one person's own workspaces must be distinguishable in their switcher.
  const sameName = await prisma.membership.findFirst({
    where: { userId, status: 'ACTIVE', organization: { name: { equals: name, mode: 'insensitive' } } },
  });
  if (sameName) {
    throw Errors.conflict('You already belong to an organization with this name. Choose a different name.', 'ORGANIZATION_NAME_IN_USE');
  }

  const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: FREE_PLAN_CODE } });
  if (!freePlan) throw new Error('Free plan missing — reference data not initialised');

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name, slug: await uniqueSlug(tx, name) } });
    const roles = await createSystemRoles(tx, organization.id);
    const membership = await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId,
        roleId: roles.OWNER.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await tx.branch.create({ data: { organizationId: organization.id, name: DEFAULT_BRANCH_NAME, isDefault: true } });
    await tx.subscription.create({
      data: { organizationId: organization.id, planId: freePlan.id, status: 'ACTIVE', currentPeriodEnd: null },
    });
    await logActivity(tx, {
      organizationId: organization.id,
      actorId: membership.id,
      action: ACTIONS.ORGANIZATION_CREATED,
      entityType: 'ORGANIZATION',
      entityId: organization.id,
      metadata: { name },
    });
    return { organization, membership };
  });
}

/**
 * The caller's organizations: only their own active memberships in active organizations, with their role
 * there. Nothing about any other tenant. `activeOrganizationId` is the session's current workspace.
 */
export async function listMyOrganizations(ctx) {
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: { id: true, organization: { select: { id: true, name: true } }, role: { select: { key: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return {
    activeOrganizationId: ctx.organizationId,
    activeMembershipId: ctx.membershipId,
    organizations: memberships.map((m) => ({
      membershipId: m.id,
      organization: m.organization,
      role: m.role,
      isActive: m.id === ctx.membershipId,
    })),
  };
}

/** Resolves the caller's own active membership in an organization (404 for anything else). */
export async function membershipFor(ctx, organizationId) {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, userId: ctx.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: { id: true },
  });
  if (!membership) throw Errors.notFound('Organization');
  return membership.id;
}

export async function getCurrentOrganization(ctx) {
  const [organization, entitlements] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId } }),
    getEntitlementSummary(ctx.organizationId),
  ]);
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    createdAt: organization.createdAt,
    closureRequest: organization.closureRequestedAt ? { requestedAt: organization.closureRequestedAt, reason: organization.closureReason } : null,
    ...entitlements,
  };
}

export async function updateOrganization(ctx, { name }) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: ctx.organizationId }, data: { name } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.ORGANIZATION_UPDATED,
      entityType: 'ORGANIZATION',
      entityId: ctx.organizationId,
      metadata: { name },
    });
  });
  return getCurrentOrganization(ctx);
}

/** Sensitive organization actions are confirmed with the person's own password. */
async function assertPassword(ctx, password) {
  if (!password || !(await verifyPassword(password, ctx.user.passwordHash))) {
    throw Errors.validation([{ field: 'password', message: 'Your password is not correct' }]);
  }
}

const ownersOnly = (ctx) => {
  if (!ctx.isOwner) throw Errors.forbidden('Only an owner can do this.', 'OWNER_ONLY');
};

/**
 * D-7: an Owner makes another active member an Owner, and may step down to another role in the same step.
 * Serialised with the last-owner rule (organization lock).
 */
export async function transferOwnership(ctx, { membershipId, password, newRoleId }) {
  ownersOnly(ctx);
  await assertPassword(ctx, password);
  if (membershipId === ctx.membershipId) throw Errors.validation([{ field: 'membershipId', message: 'Choose another member' }]);
  const [target, ownerRole, newRole] = await Promise.all([
    prisma.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId, status: 'ACTIVE' }, include: { user: true } }),
    prisma.role.findFirst({ where: { organizationId: ctx.organizationId, key: OWNER_ROLE_KEY } }),
    newRoleId ? prisma.role.findFirst({ where: { id: newRoleId, organizationId: ctx.organizationId } }) : null,
  ]);
  if (!target) throw Errors.validation([{ field: 'membershipId', message: 'Choose an active member of your organization' }]);
  if (newRoleId && (!newRole || newRole.key === OWNER_ROLE_KEY)) throw Errors.validation([{ field: 'newRoleId', message: 'Choose a role other than Owner' }]);

  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, ctx.organizationId);
    await tx.membership.update({ where: { id: target.id }, data: { roleId: ownerRole.id } });
    if (newRole) await tx.membership.update({ where: { id: ctx.membershipId }, data: { roleId: newRole.id } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.OWNERSHIP_TRANSFERRED,
      entityType: 'MEMBER',
      entityId: target.id,
      metadata: { memberName: fullName(target.user), ...(newRole && { steppedDownTo: newRole.name }) },
    });
  });
}

/**
 * D-7: anyone may leave; the last active Owner may not (transfer ownership first). Their membership becomes
 * inactive (history kept) and their branch-manager / project-lead duties are released (F-02).
 */
export async function leaveOrganization(ctx, { password }) {
  await assertPassword(ctx, password);
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, ctx.organizationId);
    if (ctx.isOwner) {
      const others = await tx.membership.count({
        where: { organizationId: ctx.organizationId, status: 'ACTIVE', role: { key: OWNER_ROLE_KEY }, NOT: { id: ctx.membershipId } },
      });
      if (!others) throw Errors.conflict('You are the last owner. Transfer ownership to someone else before leaving.', 'LAST_OWNER');
    }
    const member = await tx.membership.update({ where: { id: ctx.membershipId }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() }, include: { user: true } });
    await releaseDuties(tx, ctx.organizationId, member, ctx.membershipId);
    await logActivity(tx, { organizationId: ctx.organizationId, actorId: ctx.membershipId, action: ACTIONS.MEMBER_LEFT, entityType: 'MEMBER', entityId: ctx.membershipId, metadata: {} });
  });
}

/**
 * D-9: the Owner asks TeamFlow to close the company. Nothing is deleted: the request is recorded, the paid
 * subscription stops renewing, the company keeps working until a platform admin closes it, and the Owner can
 * withdraw the request until then.
 */
export async function requestClosure(ctx, { reason, confirmName, password }) {
  ownersOnly(ctx);
  await assertPassword(ctx, password);
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, include: { subscription: true } });
  if ((confirmName ?? '').trim() !== org.name) throw Errors.validation([{ field: 'confirmName', message: 'Type the organization name exactly to confirm' }]);
  if (org.closureRequestedAt) throw Errors.conflict('A closure request is already pending.', 'CLOSURE_ALREADY_REQUESTED');
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: org.id }, data: { closureRequestedAt: new Date(), closureReason: reason, closureRequestedById: ctx.membershipId } });
    if (isSubscriptionLive(org.subscription) && org.subscription.currentPeriodEnd) {
      await tx.subscription.update({ where: { id: org.subscription.id }, data: { cancelAtPeriodEnd: true } });
    }
    await logActivity(tx, { organizationId: org.id, actorId: ctx.membershipId, action: ACTIONS.CLOSURE_REQUESTED, entityType: 'ORGANIZATION', entityId: org.id, metadata: {} });
  });
  return getCurrentOrganization(ctx);
}

export async function withdrawClosure(ctx) {
  ownersOnly(ctx);
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
  if (!org.closureRequestedAt) throw Errors.conflict('There is no pending closure request.', 'NO_CLOSURE_REQUEST');
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: org.id }, data: { closureRequestedAt: null, closureReason: null, closureRequestedById: null } });
    await logActivity(tx, { organizationId: org.id, actorId: ctx.membershipId, action: ACTIONS.CLOSURE_WITHDRAWN, entityType: 'ORGANIZATION', entityId: org.id, metadata: {} });
  });
  return getCurrentOrganization(ctx);
}
