import { prisma } from '../../lib/prisma.js';
import { addDays, fullName, startOfTodayUtc } from '../../common/utils/http.js';
import { visibleProjectsWhere, listProjects } from '../projects/project.service.js';
import { visibleTasksWhere, myWork } from '../tasks/task.service.js';
import { recentActivities } from '../activities/activity.service.js';
import { getEntitlementSummary } from '../subscriptions/entitlement.service.js';

/**
 * "What is happening in my organization?" — answered with counts and small lists computed in
 * the database. Every block respects the same visibility and permission rules as its page;
 * blocks the caller may not see are returned as null rather than leaking aggregates.
 */
export async function getDashboard(ctx) {
  const today = startOfTodayUtc();
  const canSeeProjects = ctx.can('PROJECT_VIEW') || ctx.can('PROJECT_VIEW_ALL');
  const canSeeTasks = ctx.can('TASK_VIEW');
  const projectsWhere = { ...visibleProjectsWhere(ctx), archivedAt: null };
  const tasksWhere = visibleTasksWhere(ctx);
  const open = { ...tasksWhere, status: { not: 'COMPLETED' } };

  const count = (enabled, model, where) => (enabled ? prisma[model].count({ where }) : Promise.resolve(null));

  const [activeProjects, totalProjects, openTasks, dueSoon, overdue, totalTasks, completedTasks] = await Promise.all([
    count(canSeeProjects, 'project', { ...projectsWhere, status: 'ACTIVE' }),
    count(canSeeProjects, 'project', projectsWhere),
    count(canSeeTasks, 'task', open),
    count(canSeeTasks, 'task', { ...open, dueDate: { gte: today, lt: addDays(today, 7) } }),
    count(canSeeTasks, 'task', { ...open, dueDate: { lt: today } }),
    count(canSeeTasks, 'task', tasksWhere),
    count(canSeeTasks, 'task', { ...tasksWhere, status: 'COMPLETED' }),
  ]);

  const [work, projects, activity, workload, subscription] = await Promise.all([
    canSeeTasks ? myWork(ctx) : null,
    canSeeProjects
      ? listProjects(ctx, { page: 1, pageSize: 6, archived: false, sort: 'dueDate', order: 'asc', openOnly: true }).then((r) => r.items)
      : null,
    ctx.can('ACTIVITY_VIEW') ? recentActivities(ctx.organizationId, { take: 8 }) : null,
    ctx.can('PROJECT_VIEW_ALL') && canSeeTasks ? teamWorkload(ctx) : null,
    ctx.can('SUBSCRIPTION_VIEW') ? getEntitlementSummary(ctx.organizationId) : null,
  ]);

  return {
    stats: {
      activeProjects,
      totalProjects,
      openTasks,
      dueSoon,
      overdue,
      completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : canSeeTasks ? 0 : null,
    },
    myWork: work && {
      overdue: work.overdue.slice(0, 5),
      today: work.today.slice(0, 5),
      upcoming: work.upcoming.slice(0, 5),
      counts: { overdue: work.overdue.length, today: work.today.length, upcoming: work.upcoming.length },
    },
    projects,
    recentActivity: activity,
    workload,
    subscription,
  };
}

/** Open tasks per active member, including members with nothing assigned. */
async function teamWorkload(ctx) {
  const [members, groups, overdueGroups] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: ctx.organizationId, status: 'ACTIVE' },
      include: { user: { select: { firstName: true, lastName: true } }, role: { select: { name: true } } },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { organizationId: ctx.organizationId, status: { not: 'COMPLETED' }, assigneeId: { not: null }, project: { archivedAt: null } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { organizationId: ctx.organizationId, status: { not: 'COMPLETED' }, assigneeId: { not: null }, dueDate: { lt: startOfTodayUtc() }, project: { archivedAt: null } },
      _count: { _all: true },
    }),
  ]);
  const openBy = new Map(groups.map((g) => [g.assigneeId, g._count._all]));
  const overdueBy = new Map(overdueGroups.map((g) => [g.assigneeId, g._count._all]));
  return members
    .map((m) => ({ id: m.id, name: fullName(m.user), roleName: m.role.name, openTasks: openBy.get(m.id) ?? 0, overdueTasks: overdueBy.get(m.id) ?? 0 }))
    .sort((a, b) => b.openTasks - a.openTasks)
    .slice(0, 8);
}
