import { prisma } from '../../lib/prisma.js';
import { fullName } from '../../common/utils/http.js';
import { visibleProjectsWhere } from '../projects/project.service.js';
import { visibleTasksWhere } from '../tasks/task.service.js';

/** Quick search for the top bar — same visibility rules as the list pages. */
export async function globalSearch(ctx, q) {
  const contains = { contains: q, mode: 'insensitive' };
  const canProjects = ctx.can('PROJECT_VIEW') || ctx.can('PROJECT_VIEW_ALL');

  const [projects, tasks, members] = await Promise.all([
    canProjects
      ? prisma.project.findMany({
          where: { ...visibleProjectsWhere(ctx), archivedAt: null, name: contains },
          select: { id: true, name: true, status: true },
          take: 5,
        })
      : [],
    ctx.can('TASK_VIEW')
      ? prisma.task.findMany({
          where: { AND: [visibleTasksWhere(ctx), { title: contains }] },
          select: { id: true, title: true, status: true, project: { select: { id: true, name: true } } },
          take: 6,
        })
      : [],
    ctx.can('USER_VIEW')
      ? prisma.membership.findMany({
          where: {
            organizationId: ctx.organizationId,
            user: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] },
          },
          select: { id: true, status: true, user: { select: { firstName: true, lastName: true, email: true } } },
          take: 5,
        })
      : [],
  ]);

  return {
    projects,
    tasks,
    members: members.map((m) => ({ id: m.id, name: fullName(m.user), email: m.user.email, status: m.status })),
  };
}
