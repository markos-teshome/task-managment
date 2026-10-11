import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { mailerStatus } from '../../lib/mailer.js';
import { internalErrorSummary } from '../../lib/errorLog.js';
import { Errors } from '../../common/errors/AppError.js';
import { paginate } from '../../common/utils/http.js';
import { displayStatus } from '../subscriptions/entitlement.service.js';
import { presentPlan } from '../subscriptions/subscription.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Platform console for TeamFlow's operators (super admins): the SaaS business, not the customers' work.
 *
 * Privacy model — every response here is built from an explicit allowlist of fields:
 *  ALLOWED  organization id, name, status, creation date; plan, limits, subscription status and dates;
 *           counts of active members and branches; payment references, amounts and status; the owners'
 *           names and emails as billing contacts.
 *  NEVER    projects, tasks (not even counts), activity details, files, comments, assignments, people's
 *           work, passwords or tokens. There is no impersonation and no way into a tenant workspace:
 *           platform sessions are not accepted by tenant APIs at all.
 * Every change made here is written to the platform audit log (actor, action, target, time, IP).
 */

export const PLATFORM_ACTIONS = {
  ORGANIZATION_SUSPENDED: 'ORGANIZATION_SUSPENDED',
  ORGANIZATION_REACTIVATED: 'ORGANIZATION_REACTIVATED',
  ORGANIZATION_CLOSED: 'ORGANIZATION_CLOSED',
  ORGANIZATION_REOPENED: 'ORGANIZATION_REOPENED',
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_UPDATED: 'PLAN_UPDATED',
  PLATFORM_ADMIN_CREATED: 'PLATFORM_ADMIN_CREATED',
  PLATFORM_ADMIN_DISABLED: 'PLATFORM_ADMIN_DISABLED',
  PLATFORM_ADMIN_ENABLED: 'PLATFORM_ADMIN_ENABLED',
  PLATFORM_ADMIN_PASSWORD_RESET: 'PLATFORM_ADMIN_PASSWORD_RESET',
};

export const recordPlatformAction = (db, { actorId, action, targetType, targetId = null, metadata = {}, ipAddress = null }) =>
  db.platformAuditLog.create({ data: { actorId, action, targetType, targetId, metadata, ipAddress } });

const DAY = 86_400_000;

export async function overview() {
  const soon = new Date(Date.now() + 7 * DAY);
  const now = new Date();
  const [organizations, suspended, closed, closureRequests, paidWhileSuspended, users, revenue, byPlan, plans, failedPayments, expiring, paidLive, pendingPayments] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: 'SUSPENDED' } }),
    prisma.organization.count({ where: { status: 'CLOSED' } }),
    prisma.organization.count({ where: { closureRequestedAt: { not: null }, status: { not: 'CLOSED' } } }),
    // D-13: paying doesn't reactivate a suspended organization — the platform reviews these.
    prisma.organization.count({ where: { status: 'SUSPENDED', subscription: { status: 'ACTIVE', currentPeriodEnd: { gt: now } } } }),
    prisma.user.count(),
    prisma.payment.groupBy({ by: ['currency'], where: { status: 'SUCCEEDED' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
    prisma.subscriptionPlan.findMany({ select: { id: true, code: true, name: true } }),
    prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', currentPeriodEnd: { gte: new Date(), lte: soon } } }),
    // Paid subscriptions that are currently live (Free has no end date).
    prisma.subscription.count({ where: { status: 'ACTIVE', currentPeriodEnd: { gt: now } } }),
    prisma.payment.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    organizations,
    activeOrganizations: organizations - suspended - closed,
    suspended,
    closed,
    closureRequests,
    paidWhileSuspended,
    users,
    activePaidSubscriptions: paidLive,
    pendingPayments,
    failedPaymentsLast30Days: failedPayments,
    subscriptionsEndingWithin7Days: expiring,
    revenue: revenue.map((r) => ({ currency: r.currency, amountCents: r._sum.amountCents ?? 0, payments: r._count._all })),
    organizationsByPlan: plans.map((p) => ({ code: p.code, name: p.name, count: byPlan.find((b) => b.planId === p.id)?._count._all ?? 0 })),
  };
}

/** Allowlisted organization fields shared by the list and the detail view. */
const orgSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  closureRequestedAt: true,
  closureReason: true,
  closedAt: true,
  subscription: {
    select: {
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      plan: { select: { code: true, name: true, maxUsers: true, maxProjects: true, maxBranches: true } },
    },
  },
  _count: { select: { memberships: { where: { status: 'ACTIVE' } }, branches: { where: { status: 'ACTIVE' } } } },
};

const presentOrg = (o) => ({
  id: o.id,
  name: o.name,
  status: o.status,
  createdAt: o.createdAt,
  activeMembers: o._count.memberships,
  activeBranches: o._count.branches,
  plan: o.subscription ? { code: o.subscription.plan.code, name: o.subscription.plan.name } : null,
  subscriptionStatus: displayStatus(o.subscription),
  currentPeriodEnd: o.subscription?.currentPeriodEnd ?? null,
  closureRequestedAt: o.closureRequestedAt, // the Owner asked TeamFlow to close the company (D-9)
});

export async function listOrganizations(query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
    ...(query.status && { status: query.status }),
    ...(query.planCode && { subscription: { plan: { code: query.planCode } } }),
    ...(query.closureRequested && { closureRequestedAt: { not: null }, status: { not: 'CLOSED' } }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.organization.findMany({ where, select: orgSelect, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.organization.count({ where }),
  ]);
  return { items: items.map(presentOrg), meta: meta(total) };
}

export async function getOrganization(id) {
  const org = await prisma.organization.findUnique({ where: { id }, select: orgSelect });
  if (!org) throw Errors.notFound('Organization');
  const [owners, paid, lastPayment, failed] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: id, status: 'ACTIVE', role: { key: 'OWNER' } },
      select: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.payment.aggregate({ where: { organizationId: id, status: 'SUCCEEDED' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.payment.findFirst({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, select: { status: true, amountCents: true, currency: true, createdAt: true } }),
    prisma.payment.count({ where: { organizationId: id, status: 'FAILED' } }),
  ]);
  const sub = org.subscription;
  return {
    ...presentOrg(org),
    subscription: sub
      ? {
          status: displayStatus(sub),
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          limits: { maxUsers: sub.plan.maxUsers, maxProjects: sub.plan.maxProjects, maxBranches: sub.plan.maxBranches },
        }
      : null,
    billingContacts: owners.map((o) => ({ name: `${o.user.firstName} ${o.user.lastName}`, email: o.user.email })),
    closure: org.closureRequestedAt || org.closedAt ? { requestedAt: org.closureRequestedAt, reason: org.closureReason, closedAt: org.closedAt } : null,
    payments: { succeeded: paid._count._all, totalPaidCents: paid._sum.amountCents ?? 0, failed, last: lastPayment },
  };
}

/**
 * Changes an organization's status. Nothing is ever deleted: data, billing and history are kept.
 *  SUSPENDED — members refused (reason required); the billing manager may still resolve payment.
 *  CLOSED    — processing the Owner's closure request (D-9); members refused; reversible.
 *  ACTIVE    — reactivate / reopen (a reopened company's closure request is cleared).
 */
export async function setOrganizationStatus(actor, id, { status, reason }, ipAddress) {
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!org) throw Errors.notFound('Organization');
  if (status === 'SUSPENDED' && !reason) throw Errors.validation([{ field: 'reason', message: 'Give a reason for the suspension' }]);
  if (org.status !== status) {
    const platformAction = {
      SUSPENDED: PLATFORM_ACTIONS.ORGANIZATION_SUSPENDED,
      CLOSED: PLATFORM_ACTIONS.ORGANIZATION_CLOSED,
      ACTIVE: org.status === 'CLOSED' ? PLATFORM_ACTIONS.ORGANIZATION_REOPENED : PLATFORM_ACTIONS.ORGANIZATION_REACTIVATED,
    }[status];
    const tenantAction = { SUSPENDED: ACTIONS.ORGANIZATION_SUSPENDED, CLOSED: ACTIONS.ORGANIZATION_CLOSED, ACTIVE: ACTIONS.ORGANIZATION_REACTIVATED }[status];
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: {
          status,
          ...(status === 'CLOSED' && { closedAt: new Date() }),
          ...(status === 'ACTIVE' && org.status === 'CLOSED' && { closedAt: null, closureRequestedAt: null, closureReason: null, closureRequestedById: null }),
        },
      });
      await recordPlatformAction(tx, {
        actorId: actor.id,
        action: platformAction,
        targetType: 'ORGANIZATION',
        targetId: id,
        metadata: { name: org.name, ...(reason && { reason }) },
        ipAddress,
      });
      // The customer's own history shows it too, attributed to "TeamFlow".
      await logActivity(tx, {
        organizationId: id,
        actorId: null,
        action: tenantAction,
        entityType: 'ORGANIZATION',
        entityId: id,
        metadata: { name: org.name },
      });
    });
  }
  return getOrganization(id);
}

export async function listSubscriptions(query) {
  const { skip, take, meta } = paginate(query);
  const now = new Date();
  const where = {
    ...(query.planCode && { plan: { code: query.planCode } }),
    ...(query.status === 'EXPIRED' && { status: 'ACTIVE', currentPeriodEnd: { lte: now } }),
    ...(query.status === 'ACTIVE' && { status: 'ACTIVE', OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] }),
    ...(query.status === 'CANCELING' && { status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: { gt: now } }),
    ...(query.endingWithinDays && { currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + query.endingWithinDays * DAY) } }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.subscription.findMany({
      where,
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        organization: { select: { id: true, name: true, status: true } },
        plan: { select: { code: true, name: true, priceCents: true, currency: true } },
      },
      orderBy: [{ currentPeriodEnd: { sort: 'asc', nulls: 'last' } }],
      skip,
      take,
    }),
    prisma.subscription.count({ where }),
  ]);
  return {
    items: items.map((s) => ({
      organization: s.organization,
      plan: s.plan,
      status: displayStatus(s),
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    })),
    meta: meta(total),
  };
}

export async function listAllPlans() {
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    include: { _count: { select: { subscriptions: true } } },
  });
  return plans.map((p) => ({ ...presentPlan(p), isActive: p.isActive, sortOrder: p.sortOrder, subscribers: p._count.subscriptions }));
}

export async function createPlan(actor, data, ipAddress) {
  const exists = await prisma.subscriptionPlan.findUnique({ where: { code: data.code } });
  if (exists) throw Errors.conflict('A plan with this code already exists.', 'PLAN_CODE_TAKEN');
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.subscriptionPlan.create({ data });
    await recordPlatformAction(tx, { actorId: actor.id, action: PLATFORM_ACTIONS.PLAN_CREATED, targetType: 'PLAN', targetId: created.id, metadata: { ...data }, ipAddress });
    return created;
  });
  return presentPlan(plan);
}

/** Price changes apply to future checkouts; existing paid periods are honoured as purchased. */
export async function updatePlan(actor, id, data, ipAddress) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) throw Errors.notFound('Plan');
  if (plan.code === 'FREE' && (data.isActive === false || (data.priceCents ?? 0) > 0)) {
    throw Errors.badRequest('The Free plan is the fallback for every organization and must stay free and active.');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.subscriptionPlan.update({ where: { id }, data });
    // Old and new values of only the fields that were sent.
    const changes = Object.fromEntries(Object.keys(data).map((k) => [k, { from: plan[k], to: result[k] }]));
    await recordPlatformAction(tx, { actorId: actor.id, action: PLATFORM_ACTIONS.PLAN_UPDATED, targetType: 'PLAN', targetId: id, metadata: { code: plan.code, changes }, ipAddress });
    return result;
  });
  return presentPlan(updated);
}

export async function listPayments(query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...(query.status && { status: query.status }),
    ...(query.organizationId && { organizationId: query.organizationId }),
    ...(query.search && {
      OR: [
        { txRef: { contains: query.search, mode: 'insensitive' } },
        { organization: { name: { contains: query.search, mode: 'insensitive' } } },
      ],
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      select: {
        id: true,
        txRef: true,
        amountCents: true,
        currency: true,
        status: true,
        provider: true,
        failureReason: true,
        createdAt: true,
        confirmedAt: true,
        organization: { select: { id: true, name: true } },
        plan: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    items: items.map((p) => ({ ...p, organization: p.organization.name, organizationId: p.organization.id, plan: p.plan.name })),
    meta: meta(total),
  };
}

export async function listAuditLog(query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...(query.action && { action: query.action }),
    ...(query.organizationId && { targetType: 'ORGANIZATION', targetId: query.organizationId }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.platformAuditLog.findMany({
      where,
      include: { actor: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.platformAuditLog.count({ where }),
  ]);
  return {
    items: items.map((a) => ({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      metadata: a.metadata,
      ipAddress: a.ipAddress,
      actor: a.actor ? { name: `${a.actor.firstName} ${a.actor.lastName}`, email: a.actor.email } : null, // null = command line
      createdAt: a.createdAt,
    })),
    meta: meta(total),
  };
}

/** Operational health: dependencies and recent problems — no tenant data. */
export async function health() {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatencyMs = Date.now() - started;
  const day = new Date(Date.now() - DAY);
  const [failed24h, stalePending] = await Promise.all([
    prisma.payment.count({ where: { status: 'FAILED', updatedAt: { gte: day } } }),
    prisma.payment.count({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 3_600_000) } } }),
  ]);
  return {
    database: { ok: true, latencyMs: dbLatencyMs },
    email: { configured: !!config.SMTP_HOST || config.isTest, lastCheck: mailerStatus },
    payments: {
      provider: 'CHAPA',
      mode: config.chapaTestMode ? 'TEST' : 'LIVE',
      webhookSecretConfigured: !!config.CHAPA_WEBHOOK_SECRET,
      failedLast24h: failed24h,
      pendingOlderThan1h: stalePending,
    },
    errors: internalErrorSummary(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}
