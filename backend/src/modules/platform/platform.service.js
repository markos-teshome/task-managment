import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { paginate } from '../../common/utils/http.js';
import { displayStatus } from '../subscriptions/entitlement.service.js';
import { presentPlan } from '../subscriptions/subscription.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Platform console for the TeamFlow operator (super admin).
 * Deliberately limited to tenant *administration* — organizations, plans and revenue.
 * The operator does not browse a customer's projects, tasks or people: that is the
 * customer's business data, and the tenant API refuses requests without a membership.
 */

export async function overview() {
  const [organizations, suspended, users, revenue, byPlan] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { isPlatformAdmin: false } }),
    prisma.payment.groupBy({ by: ['currency'], where: { status: 'SUCCEEDED' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
  ]);
  const plans = await prisma.subscriptionPlan.findMany();
  return {
    organizations,
    suspended,
    users,
    revenue: revenue.map((r) => ({ currency: r.currency, amountCents: r._sum.amountCents ?? 0, payments: r._count._all })),
    organizationsByPlan: plans.map((p) => ({ code: p.code, name: p.name, count: byPlan.find((b) => b.planId === p.id)?._count._all ?? 0 })),
  };
}

export async function listOrganizations(query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
    ...(query.status && { status: query.status }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.organization.findMany({
      where,
      include: {
        subscription: { include: { plan: { select: { code: true, name: true } } } },
        _count: { select: { memberships: { where: { status: 'ACTIVE' } }, projects: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.organization.count({ where }),
  ]);
  return {
    items: items.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      createdAt: o.createdAt,
      members: o._count.memberships,
      projects: o._count.projects,
      plan: o.subscription?.plan ?? null,
      subscriptionStatus: displayStatus(o.subscription),
      currentPeriodEnd: o.subscription?.currentPeriodEnd ?? null,
    })),
    meta: meta(total),
  };
}

export async function setOrganizationStatus(id, status) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw Errors.notFound('Organization');
  if (org.status === status) return org;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({ where: { id }, data: { status } });
    await logActivity(tx, {
      organizationId: id,
      actorId: null, // shown as "TeamFlow" in the customer's timeline
      action: status === 'SUSPENDED' ? ACTIONS.ORGANIZATION_SUSPENDED : ACTIONS.ORGANIZATION_REACTIVATED,
      entityType: 'ORGANIZATION',
      entityId: id,
      metadata: { name: org.name },
    });
    return updated;
  });
}

export async function listAllPlans() {
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    include: { _count: { select: { subscriptions: true } } },
  });
  return plans.map((p) => ({ ...presentPlan(p), isActive: p.isActive, sortOrder: p.sortOrder, subscribers: p._count.subscriptions }));
}

export async function createPlan(data) {
  const exists = await prisma.subscriptionPlan.findUnique({ where: { code: data.code } });
  if (exists) throw Errors.conflict('A plan with this code already exists.', 'PLAN_CODE_TAKEN');
  return presentPlan(await prisma.subscriptionPlan.create({ data }));
}

/** Price changes apply to future checkouts; existing paid periods are honoured as purchased. */
export async function updatePlan(id, data) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) throw Errors.notFound('Plan');
  if (plan.code === 'FREE' && (data.isActive === false || (data.priceCents ?? 0) > 0)) {
    throw Errors.badRequest('The Free plan is the fallback for every organization and must stay free and active.');
  }
  return presentPlan(await prisma.subscriptionPlan.update({ where: { id }, data }));
}

export async function recentPayments(query) {
  const { skip, take, meta } = paginate(query);
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      include: { organization: { select: { name: true } }, plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.payment.count(),
  ]);
  return {
    items: items.map((p) => ({
      id: p.id,
      txRef: p.txRef,
      organization: p.organization.name,
      plan: p.plan.name,
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      provider: p.provider,
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt,
    })),
    meta: meta(total),
  };
}
