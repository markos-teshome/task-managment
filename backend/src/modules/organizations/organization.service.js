import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { FREE_PLAN_CODE } from '../../common/constants/plans.js';
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
 * Creates a tenant atomically: organization, default roles, the creator as Owner and a
 * Free subscription. Either all of it exists or none of it does.
 */
export async function createOrganization(userId, { name }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.emailVerifiedAt) throw Errors.forbidden('Verify your email before creating an organization.', 'EMAIL_NOT_VERIFIED');

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
