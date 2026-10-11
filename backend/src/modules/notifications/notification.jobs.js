import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { addDays } from '../../common/utils/http.js';
import { membersWithPermission, notify, projectResponsible } from './notification.service.js';
import { processDeliveries } from './notification.delivery.js';

/**
 * Daily reminders, run once a day at 08:00 Addis Ababa time (UTC+3, no daylight saving). Every reminder
 * carries a dedupe key, so running twice (restart, two instances) never notifies twice. Windows are short
 * so old data never causes a flood: a task gets one "due tomorrow", one "overdue" the day after, and one
 * follow-up three days later that also tells the project's responsible person.
 */
const TZ = 'Africa/Addis_Ababa';
const OFFSET_MS = 3 * 3_600_000;
const RUN_HOUR = 8;
const DAY = 86_400_000;

/** Today's calendar date in Addis Ababa, as UTC midnight (task/project dates are DATE columns). */
export function addisToday(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}
const day = (d) => d.toISOString().slice(0, 10);
const dateLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const instantLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });

const send = (args) => prisma.$transaction((tx) => notify(tx, args));
const openTask = { status: { not: 'COMPLETED' }, assigneeId: { not: null }, project: { archivedAt: null }, organization: { status: 'ACTIVE' } };
const taskSelect = {
  id: true, title: true, dueDate: true, organizationId: true, assigneeId: true,
  assignee: { select: { user: { select: { firstName: true, lastName: true } } } },
  project: { select: { id: true, name: true, leadId: true, createdById: true } },
};

async function taskReminders(today) {
  let count = 0;
  const dueTomorrow = await prisma.task.findMany({ where: { ...openTask, dueDate: addDays(today, 1) }, select: taskSelect });
  for (const t of dueTomorrow) {
    count += await send({
      organizationId: t.organizationId, recipients: [t.assigneeId], type: 'TASK_DUE_SOON',
      title: 'Task due tomorrow', message: `“${t.title}” in ${t.project.name} is due tomorrow.`,
      link: `/my-work?task=${t.id}`, entityType: 'TASK', entityId: t.id, dedupeKey: `TASK_DUE_SOON:${t.id}:${day(t.dueDate)}`,
    });
  }

  // First overdue reminder: the day after the due date (two days of slack for a missed run).
  const overdue = await prisma.task.findMany({ where: { ...openTask, dueDate: { gte: addDays(today, -2), lt: today } }, select: taskSelect });
  for (const t of overdue) {
    count += await send({
      organizationId: t.organizationId, recipients: [t.assigneeId], type: 'TASK_OVERDUE',
      title: 'Task overdue', message: `“${t.title}” in ${t.project.name} was due ${dateLabel(t.dueDate)}.`,
      link: `/my-work?task=${t.id}`, entityType: 'TASK', entityId: t.id, dedupeKey: `TASK_OVERDUE:${t.id}:${day(t.dueDate)}:1`,
    });
  }

  // Follow-up three days later: the assignee again, and the project's responsible person (escalation).
  const late = await prisma.task.findMany({ where: { ...openTask, dueDate: { gte: addDays(today, -5), lte: addDays(today, -3) } }, select: taskSelect });
  for (const t of late) {
    const due = dateLabel(t.dueDate);
    count += await send({
      organizationId: t.organizationId, recipients: [t.assigneeId], type: 'TASK_OVERDUE',
      title: 'Task still overdue', message: `“${t.title}” in ${t.project.name} has been overdue since ${due}.`,
      link: `/my-work?task=${t.id}`, entityType: 'TASK', entityId: t.id, dedupeKey: `TASK_OVERDUE:${t.id}:${day(t.dueDate)}:2`,
    });
    const responsible = projectResponsible(t.project);
    if (responsible && responsible !== t.assigneeId) {
      const name = `${t.assignee.user.firstName} ${t.assignee.user.lastName}`;
      count += await send({
        organizationId: t.organizationId, recipients: [responsible], type: 'TASK_OVERDUE',
        title: 'Overdue task in your project', message: `“${t.title}” (assigned to ${name}) in ${t.project.name} has been overdue since ${due}.`,
        link: `/projects/${t.project.id}?task=${t.id}`, entityType: 'TASK', entityId: t.id, dedupeKey: `TASK_OVERDUE_ESCALATED:${t.id}:${day(t.dueDate)}`,
      });
    }
  }
  return count;
}

async function projectReminders(today) {
  let count = 0;
  const projects = await prisma.project.findMany({
    where: { dueDate: { gte: addDays(today, 1), lte: addDays(today, 3) }, status: { notIn: ['COMPLETED', 'CANCELLED'] }, archivedAt: null, organization: { status: 'ACTIVE' } },
    select: { id: true, name: true, dueDate: true, organizationId: true, leadId: true, createdById: true },
  });
  for (const p of projects) {
    count += await send({
      organizationId: p.organizationId, recipients: [projectResponsible(p)], type: 'PROJECT_DUE_SOON',
      title: 'Project deadline approaching', message: `${p.name} is due ${dateLabel(p.dueDate)}.`,
      link: `/projects/${p.id}`, entityType: 'PROJECT', entityId: p.id, dedupeKey: `PROJECT_DUE_SOON:${p.id}:${day(p.dueDate)}`,
    });
  }
  return count;
}

/** Paid plans: 7 days and 1 day before the period ends, and once when it has ended (Free limits then apply). */
async function subscriptionReminders(now) {
  let count = 0;
  const subs = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', currentPeriodEnd: { gt: new Date(now.getTime() - 3 * DAY), lte: new Date(now.getTime() + 7 * DAY) }, organization: { status: 'ACTIVE' } },
    select: { organizationId: true, currentPeriodEnd: true, plan: { select: { name: true } } },
  });
  for (const s of subs) {
    const end = s.currentPeriodEnd;
    const recipients = await membersWithPermission(prisma, s.organizationId, 'BILLING_MANAGE');
    const base = { organizationId: s.organizationId, recipients, link: '/billing', entityType: 'SUBSCRIPTION', entityId: null };
    if (end <= now) {
      count += await send({
        ...base, type: 'SUBSCRIPTION_EXPIRED', title: 'Subscription ended',
        message: `Your ${s.plan.name} plan ended on ${instantLabel(end)}. Free plan limits apply until you renew.`,
        dedupeKey: `SUBSCRIPTION_EXPIRED:${end.toISOString()}`,
      });
    } else {
      const daysLeft = Math.ceil((end - now) / DAY);
      count += await send({
        ...base, type: 'SUBSCRIPTION_EXPIRING', title: daysLeft <= 1 ? 'Subscription ends tomorrow' : 'Subscription ends soon',
        message: `Your ${s.plan.name} plan ends on ${instantLabel(end)}. Renew to keep your current limits.`,
        dedupeKey: `SUBSCRIPTION_EXPIRING:${end.toISOString()}:${daysLeft <= 1 ? 1 : 7}`,
      });
    }
  }
  return count;
}

/** Retention: read notifications are kept 90 days, unread ones 180. */
async function prune(now) {
  const { count } = await prisma.notification.deleteMany({
    where: { OR: [{ readAt: { lt: new Date(now.getTime() - 90 * DAY) } }, { createdAt: { lt: new Date(now.getTime() - 180 * DAY) } }] },
  });
  return count;
}

export async function runDailyReminders(now = new Date()) {
  const today = addisToday(now);
  const result = {
    tasks: await taskReminders(today),
    projects: await projectReminders(today),
    subscriptions: await subscriptionReminders(now),
    pruned: await prune(now),
  };
  logger.info(result, 'Daily notification reminders done');
  return result;
}

/** In-process scheduler: the daily pass after 08:00 Addis time, and an email delivery sweep every 30 s. */
export function startNotificationJobs() {
  let lastRun = null;
  const tick = async () => {
    const now = new Date();
    const today = day(addisToday(now));
    if (lastRun !== today && new Date(now.getTime() + OFFSET_MS).getUTCHours() >= RUN_HOUR) {
      lastRun = today;
      await runDailyReminders(now).catch((err) => logger.error({ err: err.message }, 'Daily reminders failed'));
    }
  };
  tick();
  setInterval(tick, 60_000).unref();
  setInterval(() => processDeliveries().catch((err) => logger.error({ err: err.message }, 'Notification delivery run failed')), 30_000).unref();
  processDeliveries().catch(() => {});
}
