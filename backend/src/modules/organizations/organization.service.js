import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { DEFAULT_BRANCH_NAME, FREE_PLAN_CODE } from '../../common/constants/plans.js';
import { randomToken } from '../../common/utils/crypto.js';
import { slugify } from '../../common/utils/http.js';
import { createSystemRoles } from '../roles/role.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';
import { getEntitlementSummary } from '../subscriptions/entitlement.service.js';

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
