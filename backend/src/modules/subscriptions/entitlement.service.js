import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { FEATURES, FREE_PLAN_CODE } from '../../common/constants/plans.js';

/**
 * Entitlements — the only place that answers "is this organization allowed to ...?".
 * Controllers and services call these helpers; plan limits are never checked inline.
 *
 * An organization's *effective* plan is its subscribed plan while the subscription is live,
 * otherwise the Free plan. Expiry is evaluated lazily at read time, so no scheduler is needed:
 * the moment a period ends, Free limits apply. Existing data above the limit is kept
 * (nothing is deleted), but nothing new can be added until the organization upgrades.
 */

export const isSubscriptionLive = (sub, now = new Date()) =>
  !!sub && sub.status === 'ACTIVE' && (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);

/** Status as the customer should understand it. */
export const displayStatus = (sub) => {
  if (!sub) return 'NONE';
  if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd <= new Date()) return 'EXPIRED';
  return sub.status;
};

export async function getEffectivePlan(organizationId, db = prisma) {
  const subscription = await db.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (isSubscriptionLive(subscription)) return { plan: subscription.plan, subscription, isFallback: false };

  const plan = await db.subscriptionPlan.findUnique({ where: { code: FREE_PLAN_CODE } });
  return { plan, subscription, isFallback: true };
}

/** Seats include pending invitations: an invitation reserves a seat until it is accepted or revoked. */
export async function getUsage(organizationId, db = prisma) {
  const [users, projects] = await Promise.all([
    db.membership.count({ where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } } }),
    db.project.count({ where: { organizationId, archivedAt: null } }),
  ]);
  return { users, projects };
}

/**
 * Serialises quota checks per organization. Without this lock two concurrent invitations
 * could both see "2 of 3 used" and both succeed. Must be called inside a transaction.
 */
async function lockOrganization(tx, organizationId) {
  await tx.$queryRaw`SELECT id FROM "organizations" WHERE id = ${organizationId}::uuid FOR UPDATE`;
}

export async function assertCanAddUsers(tx, organizationId, count = 1) {
  await lockOrganization(tx, organizationId);
  const [{ plan }, usage] = await Promise.all([getEffectivePlan(organizationId, tx), getUsage(organizationId, tx)]);
  if (plan.maxUsers !== null && usage.users + count > plan.maxUsers) {
    throw Errors.planLimit(
      'SUBSCRIPTION_USER_LIMIT',
      `Your current plan has reached its user limit (${usage.users} of ${plan.maxUsers} members). Please upgrade your subscription to add more team members.`,
    );
  }
}

export async function assertCanCreateProject(tx, organizationId) {
  await lockOrganization(tx, organizationId);
  const [{ plan }, usage] = await Promise.all([getEffectivePlan(organizationId, tx), getUsage(organizationId, tx)]);
  if (plan.maxProjects !== null && usage.projects + 1 > plan.maxProjects) {
    throw Errors.planLimit(
      'SUBSCRIPTION_PROJECT_LIMIT',
      `Your current plan has reached its project limit (${usage.projects} of ${plan.maxProjects} active projects). Archive a project or upgrade your subscription.`,
    );
  }
}

const FEATURE_NAMES = {
  [FEATURES.DATA_EXPORT]: 'Data export',
};

export async function hasFeature(organizationId, feature, db = prisma) {
  const { plan } = await getEffectivePlan(organizationId, db);
  return plan.features.includes(feature);
}

export async function assertFeature(organizationId, feature) {
  if (await hasFeature(organizationId, feature)) return;
  // Name the cheapest plan that unlocks the feature, from live plan data rather than a hard-coded string.
  const cheapest = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true, features: { has: feature } },
    orderBy: { priceCents: 'asc' },
  });
  const suffix = cheapest ? ` It is available on the ${cheapest.name} plan and above.` : '';
  throw Errors.planLimit(
    'PLAN_FEATURE_UNAVAILABLE',
    `${FEATURE_NAMES[feature] ?? 'This feature'} is not included in your current plan.${suffix}`,
  );
}

/** Compact summary for the client: plan, limits, usage and subscription state. */
export async function getEntitlementSummary(organizationId) {
  const [{ plan, subscription, isFallback }, usage] = await Promise.all([
    getEffectivePlan(organizationId),
    getUsage(organizationId),
  ]);
  return {
    plan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      maxUsers: plan.maxUsers,
      maxProjects: plan.maxProjects,
      features: plan.features,
    },
    usage,
    subscription: subscription
      ? {
          planCode: subscription.plan.code,
          planName: subscription.plan.name,
          status: displayStatus(subscription),
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    isFallback,
  };
}
