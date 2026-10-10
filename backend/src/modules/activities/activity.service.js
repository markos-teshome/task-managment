import { prisma } from '../../lib/prisma.js';
import { visibleProjectsWhere } from '../projects/project.service.js';
import { fullName, paginate } from '../../common/utils/http.js';

export const ACTIONS = {
  ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  ORGANIZATION_SUSPENDED: 'ORGANIZATION_SUSPENDED',
  ORGANIZATION_REACTIVATED: 'ORGANIZATION_REACTIVATED',

  MEMBER_INVITED: 'MEMBER_INVITED',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
  MEMBER_DEACTIVATED: 'MEMBER_DEACTIVATED',
  MEMBER_REACTIVATED: 'MEMBER_REACTIVATED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',

  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',

  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_UPDATED: 'PROJECT_UPDATED',
  PROJECT_STATUS_CHANGED: 'PROJECT_STATUS_CHANGED',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_RESTORED: 'PROJECT_RESTORED',
  PROJECT_DELETED: 'PROJECT_DELETED',
  PROJECT_MEMBER_ADDED: 'PROJECT_MEMBER_ADDED',
  PROJECT_MEMBER_REMOVED: 'PROJECT_MEMBER_REMOVED',

  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_DELETED: 'TASK_DELETED',

  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_CANCELED: 'SUBSCRIPTION_CANCELED',
  SUBSCRIPTION_RESUMED: 'SUBSCRIPTION_RESUMED',

  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  BRANCH_ARCHIVED: 'BRANCH_ARCHIVED',
  BRANCH_REACTIVATED: 'BRANCH_REACTIVATED',
  BRANCH_DEFAULT_CHANGED: 'BRANCH_DEFAULT_CHANGED',
  BRANCH_MEMBER_ADDED: 'BRANCH_MEMBER_ADDED',
  BRANCH_MEMBER_REMOVED: 'BRANCH_MEMBER_REMOVED',
};

const STATUS_LABELS = {
  TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', COMPLETED: 'Completed',
  PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', CANCELLED: 'Cancelled',
};
const label = (s) => STATUS_LABELS[s] ?? s;

/** Human-readable sentence (without the actor) for each action. */
const DESCRIBE = {
  ORGANIZATION_CREATED: (m) => `created the organization "${m.name}"`,
  ORGANIZATION_UPDATED: (m) => `renamed the organization to "${m.name}"`,
  ORGANIZATION_SUSPENDED: () => 'suspended this organization',
  ORGANIZATION_REACTIVATED: () => 'reactivated this organization',
  BRANCH_CREATED: (m) => `created the branch "${m.name}"`,
  BRANCH_UPDATED: (m) => `updated the branch "${m.name}"`,
  BRANCH_ARCHIVED: (m) => `archived the branch "${m.name}"${m.movedProjects ? ` and moved ${m.movedProjects} project(s) to ${m.movedTo}` : ''}`,
  BRANCH_REACTIVATED: (m) => `reactivated the branch "${m.name}"`,
  BRANCH_DEFAULT_CHANGED: (m) => `made "${m.name}" the default branch`,
  BRANCH_MEMBER_ADDED: (m) => `added ${m.memberNames} to the branch "${m.name}"`,
  BRANCH_MEMBER_REMOVED: (m) => `removed ${m.memberName} from the branch "${m.name}"`,
  MEMBER_INVITED: (m) => `invited ${m.memberName} as ${m.roleName}`,
  MEMBER_JOINED: () => 'joined the organization',
  MEMBER_ROLE_CHANGED: (m) => `changed ${m.memberName}'s role from ${m.fromRole} to ${m.toRole}`,
  MEMBER_DEACTIVATED: (m) => `deactivated ${m.memberName}`,
  MEMBER_REACTIVATED: (m) => `reactivated ${m.memberName}`,
  INVITATION_REVOKED: (m) => `revoked the invitation for ${m.memberName}`,
  ROLE_CREATED: (m) => `created the role "${m.name}"`,
  ROLE_UPDATED: (m) => `updated the role "${m.name}"`,
  ROLE_DELETED: (m) => `deleted the role "${m.name}"`,
  PROJECT_CREATED: (m) => `created project "${m.name}"`,
  PROJECT_UPDATED: (m) => `updated project "${m.name}"`,
  PROJECT_STATUS_CHANGED: (m) => `moved project "${m.name}" to ${label(m.to)}`,
  PROJECT_ARCHIVED: (m) => `archived project "${m.name}"`,
  PROJECT_RESTORED: (m) => `restored project "${m.name}"`,
  PROJECT_DELETED: (m) => `deleted project "${m.name}"`,
  PROJECT_MEMBER_ADDED: (m) => `added ${m.memberName} to "${m.projectName}"`,
  PROJECT_MEMBER_REMOVED: (m) => `removed ${m.memberName} from "${m.projectName}"`,
  TASK_CREATED: (m) => `created task "${m.title}"`,
  TASK_UPDATED: (m) => `updated task "${m.title}"`,
  TASK_ASSIGNED: (m) => (m.assigneeName ? `assigned "${m.title}" to ${m.assigneeName}` : `unassigned "${m.title}"`),
  TASK_STATUS_CHANGED: (m) => `moved "${m.title}" to ${label(m.to)}`,
  TASK_COMPLETED: (m) => `completed "${m.title}"`,
  TASK_DELETED: (m) => `deleted task "${m.title}"`,
  SUBSCRIPTION_CHANGED: (m) => `changed the subscription from ${m.fromPlan} to ${m.toPlan}`,
  SUBSCRIPTION_RENEWED: (m) => `renewed the ${m.plan} subscription`,
  SUBSCRIPTION_CANCELED: (m) => `scheduled the ${m.plan} subscription to end`,
  SUBSCRIPTION_RESUMED: (m) => `resumed the ${m.plan} subscription`,
  PAYMENT_INITIATED: (m) => `started a payment for ${m.plan}`,
  PAYMENT_COMPLETED: (m) => `completed a payment of ${m.amount} for ${m.plan}`,
  PAYMENT_FAILED: (m) => `had a failed payment for ${m.plan}`,
};

/**
 * Records an activity. Pass the transaction client when the activity must commit
 * atomically with the business change it describes.
 */
export function logActivity(db, { organizationId, actorId = null, action, entityType, entityId = null, projectId = null, metadata = {} }) {
  return (db ?? prisma).activityLog.create({
    data: { organizationId, actorId, action, entityType, entityId, projectId, metadata },
  });
}

export function presentActivity(a) {
  const describe = DESCRIBE[a.action];
  return {
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    projectId: a.projectId,
    createdAt: a.createdAt,
    actor: a.actor ? { id: a.actor.id, name: fullName(a.actor.user) } : null,
    message: describe ? describe(a.metadata ?? {}) : a.action.toLowerCase().replaceAll('_', ' '),
  };
}

const actorInclude = { actor: { include: { user: { select: { firstName: true, lastName: true } } } } };

/**
 * Entries about a project are only shown to people who can see that project, so a branch project's name
 * never reaches someone outside the branch through the history. People with BRANCH_MANAGE see everything.
 */
async function projectScope(ctx) {
  if (ctx.can('BRANCH_MANAGE')) return {};
  const visible = await prisma.project.findMany({ where: visibleProjectsWhere(ctx), select: { id: true } });
  return { OR: [{ projectId: null }, { projectId: { in: visible.map((p) => p.id) } }] };
}

export async function listActivities(ctx, query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    ...(await projectScope(ctx)),
    organizationId: ctx.organizationId,
    ...(query.actorId && { actorId: query.actorId }),
    ...(query.entityType && { entityType: query.entityType }),
    ...(query.projectId && { projectId: query.projectId }),
    ...(query.entityId && { entityId: query.entityId }),
    ...((query.from || query.to) && {
      createdAt: { ...(query.from && { gte: query.from }), ...(query.to && { lt: new Date(query.to.getTime() + 86_400_000) }) },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.activityLog.findMany({ where, include: actorInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.activityLog.count({ where }),
  ]);
  return { items: items.map(presentActivity), meta: meta(total) };
}

/** Latest entries for the dashboard (scoped like the history) or for one project the caller can already see. */
export async function recentActivities(ctx, { take = 10, projectId } = {}) {
  const items = await prisma.activityLog.findMany({
    where: { organizationId: ctx.organizationId, ...(projectId ? { projectId } : await projectScope(ctx)) },
    include: actorInclude,
    orderBy: { createdAt: 'desc' },
    take,
  });
  return items.map(presentActivity);
}
