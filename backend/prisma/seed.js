/**
 * Demo data: two independent tenants so isolation can be seen, not just claimed.
 *  - Abay Trading PLC      — Professional subscription (provisioned by the seed), all four roles,
 *                            a custom role, rich history.
 *  - Gift Construction PLC — Free plan sitting exactly at its 3-member limit.
 *  - A platform super admin (TeamFlow operator).
 * Dates are relative to today so "overdue", "due today" and "upcoming" always make sense.
 * No payment records are created: payments only ever come from real Chapa transactions.
 *
 * Re-running the seed wipes and recreates everything, so it refuses to run on a database that
 * holds data the seed did not create (e.g. real sign-ups or Chapa payments) unless SEED_FORCE=1.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureReferenceData } from '../src/bootstrap.js';
import { createSystemRoles } from '../src/modules/roles/role.service.js';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Demo@1234';
const DAY = 86_400_000;

const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const day = (offset) => new Date(todayUtc().getTime() + offset * DAY);
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

const SEED_SLUGS = ['abay-trading', 'gift-construction'];

/** Refuses to wipe a database that contains anything other than seed data. */
async function assertSafeToReset() {
  if (process.env.SEED_FORCE === '1') return;
  const [foreignOrgs, payments] = await Promise.all([
    prisma.organization.count({ where: { slug: { notIn: SEED_SLUGS } } }),
    prisma.payment.count(),
  ]);
  if (foreignOrgs || payments) {
    console.error(
      'Refusing to reset: this database contains ' +
        [foreignOrgs && `${foreignOrgs} organization(s) not created by the seed`, payments && `${payments} payment record(s)`].filter(Boolean).join(' and ') +
        '.\nThe seed deletes ALL data. Run it on an empty database, or set SEED_FORCE=1 to wipe everything anyway.',
    );
    process.exit(1);
  }
}

async function reset() {
  await prisma.organization.deleteMany(); // cascades to all tenant data
  await prisma.user.deleteMany();
}

async function createUser({ email, firstName, lastName, isPlatformAdmin = false }, passwordHash) {
  return prisma.user.create({
    data: { email, firstName, lastName, passwordHash, isPlatformAdmin, emailVerifiedAt: ago(60) },
  });
}

async function createTenant({ name, slug, plan, createdDaysAgo, people, customRoles = [] }, passwordHash) {
  const org = await prisma.organization.create({ data: { name, slug, createdAt: ago(createdDaysAgo) } });
  const roles = await prisma.$transaction((tx) => createSystemRoles(tx, org.id));

  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  for (const r of customRoles) {
    roles[r.name] = await prisma.role.create({
      data: {
        organizationId: org.id,
        name: r.name,
        description: r.description,
        permissions: { create: r.permissions.map((k) => ({ permissionId: permissionIds.get(k) })) },
      },
    });
  }

  const members = {};
  for (const p of people) {
    const user =
      p.status === 'INVITED'
        ? await prisma.user.create({ data: { email: p.email, firstName: p.firstName, lastName: p.lastName } })
        : await createUser(p, passwordHash);
    members[p.key] = await prisma.membership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: roles[p.role].id,
        status: p.status ?? 'ACTIVE',
        jobTitle: p.jobTitle,
        joinedAt: p.status === 'INVITED' ? null : ago(p.joinedDaysAgo ?? createdDaysAgo),
        deactivatedAt: p.status === 'DEACTIVATED' ? ago(5) : null,
        createdAt: ago(p.joinedDaysAgo ?? createdDaysAgo),
      },
      include: { user: true },
    });
    members[p.key].roleName = roles[p.role].name;
  }

  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: plan.priceCents ? ago(12) : ago(createdDaysAgo),
      currentPeriodEnd: plan.priceCents ? day(18) : null,
    },
  });

  return { org, roles, members };
}

function activityWriter(organizationId) {
  const rows = [];
  return {
    add: (actor, action, entityType, { entityId = null, projectId = null, metadata = {}, at }) =>
      rows.push({ organizationId, actorId: actor?.id ?? null, action, entityType, entityId, projectId, metadata, createdAt: at }),
    flush: () => prisma.activityLog.createMany({ data: rows }),
  };
}

const name = (m) => `${m.user.firstName} ${m.user.lastName}`;

async function createProjects(tenant, projects, log) {
  for (const [pi, p] of projects.entries()) {
    const createdAt = ago(p.createdDaysAgo);
    const creator = tenant.members[p.createdBy];
    const team = [...new Set([...(p.team ?? []), ...(p.lead ? [p.lead] : [])])];
    const project = await prisma.project.create({
      data: {
        organizationId: tenant.org.id,
        name: p.name,
        description: p.description,
        status: p.status,
        priority: p.priority,
        startDate: p.start != null ? day(p.start) : null,
        dueDate: p.due != null ? day(p.due) : null,
        leadId: p.lead ? tenant.members[p.lead].id : null,
        createdById: creator.id,
        archivedAt: p.archived ? ago(2) : null,
        createdAt,
        members: { create: team.map((k) => ({ membershipId: tenant.members[k].id, createdAt })) },
      },
    });
    log.add(creator, 'PROJECT_CREATED', 'PROJECT', { entityId: project.id, projectId: project.id, metadata: { name: p.name }, at: createdAt });

    for (const [ti, t] of (p.tasks ?? []).entries()) {
      const assignee = t.assignee ? tenant.members[t.assignee] : null;
      const taskCreated = new Date(createdAt.getTime() + (ti + 1) * 3_600_000);
      const completedAt = t.status === 'COMPLETED' ? ago(t.completedDaysAgo ?? 3, pi + ti) : null;
      const task = await prisma.task.create({
        data: {
          organizationId: tenant.org.id,
          projectId: project.id,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          priority: t.priority ?? 'MEDIUM',
          assigneeId: assignee?.id ?? null,
          createdById: creator.id,
          dueDate: t.due != null ? day(t.due) : null,
          completedAt,
          createdAt: taskCreated,
        },
      });
      const base = { entityId: task.id, projectId: project.id };
      log.add(creator, 'TASK_CREATED', 'TASK', { ...base, metadata: { title: t.title, projectName: p.name }, at: taskCreated });
      if (assignee) {
        log.add(creator, 'TASK_ASSIGNED', 'TASK', { ...base, metadata: { title: t.title, assigneeName: name(assignee) }, at: new Date(taskCreated.getTime() + 60_000) });
      }
      if (t.status === 'IN_PROGRESS' || t.status === 'BLOCKED') {
        log.add(assignee ?? creator, 'TASK_STATUS_CHANGED', 'TASK', { ...base, metadata: { title: t.title, from: 'TODO', to: t.status }, at: ago(1, ti + 2) });
      }
      if (completedAt) {
        log.add(assignee ?? creator, 'TASK_COMPLETED', 'TASK', { ...base, metadata: { title: t.title, from: 'IN_PROGRESS', to: 'COMPLETED' }, at: completedAt });
      }
    }
  }
}

async function main() {
  await ensureReferenceData(prisma);
  await assertSafeToReset();
  await reset();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));

  // ── Platform operator ──
  await createUser({ email: 'admin@teamflow.test', firstName: 'Platform', lastName: 'Admin', isPlatformAdmin: true }, passwordHash);

  // ── Tenant 1: Abay Trading PLC (Professional) ──
  const abay = await createTenant(
    {
      name: 'Abay Trading PLC',
      slug: 'abay-trading',
      plan: plans.PROFESSIONAL,
      createdDaysAgo: 40,
      customRoles: [
        {
          name: 'QA Reviewer',
          description: 'Reviews and updates tasks across all projects.',
          permissions: ['PROJECT_VIEW', 'PROJECT_VIEW_ALL', 'TASK_VIEW', 'TASK_UPDATE', 'ACTIVITY_VIEW'],
        },
      ],
      people: [
        { key: 'abebe', email: 'abebe@abaytrading.test', firstName: 'Abebe', lastName: 'Kebede', role: 'OWNER', jobTitle: 'General Manager' },
        { key: 'sara', email: 'sara@abaytrading.test', firstName: 'Sara', lastName: 'Alemu', role: 'ADMIN', jobTitle: 'Operations Lead', joinedDaysAgo: 38 },
        { key: 'dawit', email: 'dawit@abaytrading.test', firstName: 'Dawit', lastName: 'Bekele', role: 'MANAGER', jobTitle: 'Project Manager', joinedDaysAgo: 36 },
        { key: 'hana', email: 'hana@abaytrading.test', firstName: 'Hana', lastName: 'Tadesse', role: 'EMPLOYEE', jobTitle: 'Frontend Developer', joinedDaysAgo: 30 },
        { key: 'yonas', email: 'yonas@abaytrading.test', firstName: 'Yonas', lastName: 'Girma', role: 'EMPLOYEE', jobTitle: 'Marketing Officer', joinedDaysAgo: 28 },
        { key: 'bethel', email: 'bethel@abaytrading.test', firstName: 'Bethel', lastName: 'Assefa', role: 'QA Reviewer', jobTitle: 'QA Engineer', joinedDaysAgo: 20 },
        { key: 'meron', email: 'meron@abaytrading.test', firstName: 'Meron', lastName: 'Haile', role: 'EMPLOYEE', jobTitle: 'DevOps Engineer', status: 'DEACTIVATED', joinedDaysAgo: 35 },
        { key: 'kalkidan', email: 'kalkidan@abaytrading.test', firstName: 'Kalkidan', lastName: 'Mulu', role: 'EMPLOYEE', jobTitle: 'Sales Associate', status: 'INVITED' },
      ],
    },
    passwordHash,
  );
  const abayLog = activityWriter(abay.org.id);
  const A = abay.members;

  abayLog.add(A.abebe, 'ORGANIZATION_CREATED', 'ORGANIZATION', { entityId: abay.org.id, metadata: { name: abay.org.name }, at: ago(40) });
  for (const k of ['sara', 'dawit', 'hana', 'yonas', 'meron', 'bethel']) {
    const inviter = k === 'sara' ? A.abebe : A.sara;
    abayLog.add(inviter, 'MEMBER_INVITED', 'MEMBER', { entityId: A[k].id, metadata: { memberName: name(A[k]), roleName: A[k].roleName }, at: new Date(A[k].createdAt.getTime() - 3_600_000) });
    abayLog.add(A[k], 'MEMBER_JOINED', 'MEMBER', { entityId: A[k].id, at: A[k].joinedAt });
  }
  abayLog.add(A.sara, 'MEMBER_INVITED', 'MEMBER', { entityId: A.kalkidan.id, metadata: { memberName: name(A.kalkidan), roleName: 'Employee' }, at: ago(1, 3) });
  abayLog.add(A.sara, 'MEMBER_DEACTIVATED', 'MEMBER', { entityId: A.meron.id, metadata: { memberName: name(A.meron) }, at: ago(5) });
  abayLog.add(A.abebe, 'ROLE_CREATED', 'ROLE', { entityId: abay.roles['QA Reviewer'].id, metadata: { name: 'QA Reviewer' }, at: ago(21) });

  await createProjects(
    abay,
    [
      {
        name: 'Website Development',
        description: 'New corporate website with product catalogue and customer login.',
        status: 'ACTIVE', priority: 'HIGH', start: -20, due: 14, lead: 'dawit', team: ['hana', 'bethel', 'meron'], createdBy: 'dawit', createdDaysAgo: 22,
        tasks: [
          { title: 'Design Homepage', assignee: 'hana', status: 'COMPLETED', priority: 'HIGH', due: -10, completedDaysAgo: 11 },
          { title: 'Create Login', assignee: 'hana', status: 'IN_PROGRESS', priority: 'HIGH', due: 0, description: 'Email + password login with password recovery.' },
          { title: 'Build Dashboard', assignee: 'hana', status: 'TODO', priority: 'MEDIUM', due: 5 },
          { title: 'Fix mobile navigation', assignee: 'hana', status: 'BLOCKED', priority: 'URGENT', due: -2, description: 'Waiting for final menu structure from marketing.' },
          { title: 'Test Application', assignee: 'bethel', status: 'TODO', priority: 'HIGH', due: 10 },
          { title: 'Set up CI pipeline', assignee: 'meron', status: 'COMPLETED', priority: 'MEDIUM', due: -12, completedDaysAgo: 13 },
          { title: 'Deploy System', assignee: 'dawit', status: 'TODO', priority: 'HIGH', due: 14 },
        ],
      },
      {
        name: 'Marketing Campaign Q4',
        description: 'Holiday season campaign across social media, radio and partner stores.',
        status: 'ACTIVE', priority: 'MEDIUM', start: -10, due: 25, lead: 'dawit', team: ['yonas', 'sara'], createdBy: 'sara', createdDaysAgo: 12,
        tasks: [
          { title: 'Market research report', assignee: 'yonas', status: 'COMPLETED', due: -4, completedDaysAgo: 4 },
          { title: 'Social media calendar', assignee: 'yonas', status: 'IN_PROGRESS', priority: 'HIGH', due: 2 },
          { title: 'Brochure design', assignee: 'yonas', status: 'TODO', priority: 'MEDIUM', due: -1 },
          { title: 'Partner store outreach', assignee: null, status: 'TODO', priority: 'LOW', due: 20 },
        ],
      },
      {
        name: 'ERP Integration',
        description: 'Connect inventory and accounting to a single ERP system.',
        status: 'PLANNING', priority: 'URGENT', start: 7, due: 60, lead: 'sara', team: ['dawit'], createdBy: 'abebe', createdDaysAgo: 3,
        tasks: [
          { title: 'Requirements workshop', assignee: 'dawit', status: 'TODO', priority: 'HIGH', due: 8 },
          { title: 'Vendor evaluation', assignee: 'sara', status: 'TODO', priority: 'MEDIUM', due: 15 },
        ],
      },
      {
        name: 'Warehouse Inventory Audit',
        description: 'Annual stock count for the Merkato warehouse.',
        status: 'COMPLETED', priority: 'LOW', start: -35, due: -15, lead: 'dawit', team: ['hana', 'yonas'], createdBy: 'dawit', createdDaysAgo: 36,
        tasks: [
          { title: 'Count section A', assignee: 'yonas', status: 'COMPLETED', due: -25, completedDaysAgo: 26 },
          { title: 'Count section B', assignee: 'hana', status: 'COMPLETED', due: -22, completedDaysAgo: 22 },
          { title: 'Reconcile with accounting', assignee: 'dawit', status: 'COMPLETED', due: -16, completedDaysAgo: 16 },
        ],
      },
      {
        name: 'Customer Portal Revamp',
        description: 'Paused until the website launch is complete.',
        status: 'ON_HOLD', priority: 'MEDIUM', start: null, due: null, lead: null, team: [], createdBy: 'abebe', createdDaysAgo: 8,
        tasks: [{ title: 'Collect customer feedback', assignee: null, status: 'TODO', priority: 'LOW', due: null }],
      },
    ],
    abayLog,
  );
  await abayLog.flush();

  // ── Tenant 2: Gift Construction PLC (Free, at the 3-member limit) ──
  const gift = await createTenant(
    {
      name: 'Gift Construction PLC',
      slug: 'gift-construction',
      plan: plans.FREE,
      createdDaysAgo: 18,
      people: [
        { key: 'kebede', email: 'kebede@giftconstruction.test', firstName: 'Kebede', lastName: 'Worku', role: 'OWNER', jobTitle: 'Managing Director' },
        { key: 'liya', email: 'liya@giftconstruction.test', firstName: 'Liya', lastName: 'Mekonnen', role: 'MANAGER', jobTitle: 'Site Manager', joinedDaysAgo: 16 },
        { key: 'samuel', email: 'samuel@giftconstruction.test', firstName: 'Samuel', lastName: 'Tesfaye', role: 'EMPLOYEE', jobTitle: 'Civil Engineer', joinedDaysAgo: 15 },
      ],
    },
    passwordHash,
  );
  const giftLog = activityWriter(gift.org.id);
  const G = gift.members;
  giftLog.add(G.kebede, 'ORGANIZATION_CREATED', 'ORGANIZATION', { entityId: gift.org.id, metadata: { name: gift.org.name }, at: ago(18) });
  for (const k of ['liya', 'samuel']) {
    giftLog.add(G.kebede, 'MEMBER_INVITED', 'MEMBER', { entityId: G[k].id, metadata: { memberName: name(G[k]), roleName: G[k].roleName }, at: ago(17) });
    giftLog.add(G[k], 'MEMBER_JOINED', 'MEMBER', { entityId: G[k].id, at: G[k].joinedAt });
  }
  await createProjects(
    gift,
    [
      {
        name: 'Bole Apartment Block',
        description: 'G+12 residential building in Bole sub-city.',
        status: 'ACTIVE', priority: 'HIGH', start: -15, due: 120, lead: 'liya', team: ['samuel'], createdBy: 'kebede', createdDaysAgo: 15,
        tasks: [
          { title: 'Foundation inspection', assignee: 'samuel', status: 'COMPLETED', priority: 'HIGH', due: -5, completedDaysAgo: 5 },
          { title: 'Steel delivery schedule', assignee: 'samuel', status: 'IN_PROGRESS', due: 3 },
          { title: 'Site safety audit', assignee: 'liya', status: 'TODO', priority: 'URGENT', due: -3 },
          { title: 'Building permit renewal', assignee: 'kebede', status: 'TODO', priority: 'HIGH', due: 10 },
        ],
      },
      {
        name: 'Road Rehabilitation – Adama',
        description: '8 km asphalt rehabilitation for the city administration.',
        status: 'PLANNING', priority: 'MEDIUM', start: 5, due: 90, lead: 'liya', team: ['samuel'], createdBy: 'liya', createdDaysAgo: 6,
        tasks: [
          { title: 'Route survey', assignee: 'samuel', status: 'TODO', due: 12 },
          { title: 'Budget estimate', assignee: 'liya', status: 'IN_PROGRESS', priority: 'HIGH', due: 6 },
        ],
      },
    ],
    giftLog,
  );
  await giftLog.flush();

  console.log(`Seed complete. All demo accounts use the password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
