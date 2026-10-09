import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { BILLING_PERIOD_DAYS } from '../../common/constants/plans.js';
import { addDays } from '../../common/utils/http.js';
import { getEntitlementSummary, getUsage, isSubscriptionLive } from './entitlement.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

export const presentPlan = (p) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description,
  priceCents: p.priceCents,
  currency: p.currency,
  maxUsers: p.maxUsers,
  maxProjects: p.maxProjects,
  features: p.features,
});

export async function listPlans() {
  const plans = await prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] });
  return plans.map(presentPlan);
}

export async function getSubscriptionOverview(ctx) {
  const [summary, plans] = await Promise.all([getEntitlementSummary(ctx.organizationId), listPlans()]);
  return { ...summary, plans };
}

/**
 * A plan change must not leave the organization over its new limits — otherwise "downgrading"
 * would be a way to keep 10 users on a 3-user price.
 */
export async function assertPlanFitsUsage(organizationId, plan) {
  const usage = await getUsage(organizationId);
  const problems = [];
  if (plan.maxUsers !== null && usage.users > plan.maxUsers) {
    problems.push(`${usage.users} members (limit ${plan.maxUsers})`);
  }
  if (plan.maxProjects !== null && usage.projects > plan.maxProjects) {
    problems.push(`${usage.projects} active projects (limit ${plan.maxProjects})`);
  }
  if (problems.length) {
    throw Errors.conflict(
      `Your organization currently has ${problems.join(' and ')}, which exceeds the ${plan.name} plan. Reduce usage before switching.`,
      'PLAN_USAGE_EXCEEDS_LIMIT',
    );
  }
}

/**
 * Activates a paid plan after a confirmed payment. Must run inside the payment-confirmation
 * transaction. Paying again for the current, still-active plan extends it from its end date;
 * any other change starts a fresh period today (no proration — a documented simplification).
 */
export async function activatePaidPlan(tx, { organizationId, plan, actorId }) {
  const current = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  const now = new Date();
  const isRenewal = isSubscriptionLive(current) && current.planId === plan.id && current.currentPeriodEnd;
  const periodStart = isRenewal ? current.currentPeriodStart : now;
  const periodEnd = addDays(isRenewal ? current.currentPeriodEnd : now, BILLING_PERIOD_DAYS);

  const data = { planId: plan.id, status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false };
  await tx.subscription.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });

  await logActivity(tx, {
    organizationId,
    actorId,
    action: isRenewal ? ACTIONS.SUBSCRIPTION_RENEWED : ACTIONS.SUBSCRIPTION_CHANGED,
    entityType: 'SUBSCRIPTION',
    entityId: null,
    metadata: isRenewal ? { plan: plan.name } : { fromPlan: isSubscriptionLive(current) ? current.plan.name : 'Free', toPlan: plan.name },
  });
}

async function liveSubscription(ctx) {
  const sub = await prisma.subscription.findUnique({ where: { organizationId: ctx.organizationId }, include: { plan: true } });
  if (!isSubscriptionLive(sub) || !sub.currentPeriodEnd) {
    throw Errors.conflict('There is no active paid subscription to change.', 'NO_PAID_SUBSCRIPTION');
  }
  return sub;
}

/** Cancels at period end: the organization keeps what it paid for, then falls back to Free. */
export async function cancelSubscription(ctx) {
  const sub = await liveSubscription(ctx);
  if (!sub.cancelAtPeriodEnd) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
      await logActivity(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.membershipId,
        action: ACTIONS.SUBSCRIPTION_CANCELED,
        entityType: 'SUBSCRIPTION',
        metadata: { plan: sub.plan.name },
      });
    });
  }
  return getSubscriptionOverview(ctx);
}

export async function resumeSubscription(ctx) {
  const sub = await liveSubscription(ctx);
  if (sub.cancelAtPeriodEnd) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
      await logActivity(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.membershipId,
        action: ACTIONS.SUBSCRIPTION_RESUMED,
        entityType: 'SUBSCRIPTION',
        metadata: { plan: sub.plan.name },
      });
    });
  }
  return getSubscriptionOverview(ctx);
}
