import { beforeEach, describe, expect, it } from 'vitest';
import { as, createPlatformAdmin, createProject, createTask, createTenant, login, PASSWORD, platform, platformLogin, prisma, resetDb } from './helpers.js';

/** Approved business rules (BUSINESS_RULES_FINAL.md): D-1 … D-13, F-01, F-02. */
let T, tk, plans;
const id = (key) => (key === 'owner' ? T.owner.membership.id : T.members[key].membership.id);

beforeEach(async () => {
  await resetDb();
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  T = await createTenant({
    name: 'Rules Co',
    members: [
      { key: 'admin', role: 'ADMIN' },
      { key: 'admin2', role: 'ADMIN' },
      { key: 'manager', role: 'MANAGER' },
      { key: 'manager2', role: 'MANAGER' },
      { key: 'emp', role: 'EMPLOYEE' },
    ],
  });
  // Business plan: room for the members, projects and branches these tests need.
  await prisma.subscription.update({ where: { organizationId: T.org.id }, data: { planId: plans.BUSINESS.id, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  tk = {};
  for (const key of ['owner', 'admin', 'admin2', 'manager', 'manager2', 'emp']) tk[key] = await login((key === 'owner' ? T.owner : T.members[key]).user.email);
});

describe('D-1 permanent project deletion: Owner only, archived only, typed name', () => {
  it('admins cannot delete; owners must archive first and type the name; history keeps the record', async () => {
    const p = await createProject(tk.owner, { name: 'Old Tender', memberIds: [id('emp')] });
    await createTask(tk.owner, p.id, { title: 'Quote', assigneeId: id('emp') });

    const byAdmin = await as(tk.admin).delete(`/projects/${p.id}`).send({ confirmName: 'Old Tender' });
    expect(byAdmin.status).toBe(403);
    const notArchived = await as(tk.owner).delete(`/projects/${p.id}`).send({ confirmName: 'Old Tender' });
    expect(notArchived.body.error.code).toBe('PROJECT_NOT_ARCHIVED');

    await as(tk.owner).post(`/projects/${p.id}/archive`);
    expect((await as(tk.owner).delete(`/projects/${p.id}`).send({ confirmName: 'old tender' })).status).toBe(422);
    expect((await as(tk.owner).delete(`/projects/${p.id}`).send({ confirmName: 'Old Tender' })).status).toBe(200);

    const entry = await prisma.activityLog.findFirst({ where: { organizationId: T.org.id, action: 'PROJECT_DELETED' } });
    expect(entry.metadata).toMatchObject({ name: 'Old Tender', taskCount: 1 });
  });

  it('PROJECT_DELETE is owner-only: no custom or system role can be given it', async () => {
    const res = await as(tk.owner).post('/roles').send({ name: 'Cleaner', permissions: ['PROJECT_VIEW', 'PROJECT_DELETE'] });
    expect(res.status).toBe(422);
    const catalog = (await as(tk.owner).get('/roles/permissions')).body.data;
    expect(catalog.find((p) => p.key === 'PROJECT_DELETE').ownerOnly).toBe(true);
    const adminRole = T.roles.ADMIN;
    expect((await as(tk.owner).patch(`/roles/${adminRole.id}`).send({ permissions: ['PROJECT_VIEW', 'PROJECT_DELETE'] })).status).toBe(422);
  });
});

describe('D-2 permanent task deletion: Owner and Admin, not Managers', () => {
  it('a manager cannot delete tasks; an admin can', async () => {
    const p = await createProject(tk.manager, { name: 'Ops' });
    const t = await createTask(tk.manager, p.id, { title: 'Count stock' });
    const byManager = await as(tk.manager).delete(`/tasks/${t.id}`);
    expect(byManager.status).toBe(403);
    expect((await as(tk.admin).delete(`/tasks/${t.id}`)).status).toBe(200);
  });
});

describe('D-3 visibility ≠ editing: management scope', () => {
  it('a manager can see but not edit a project outside his scope; lead, creator, team member and branch manager can', async () => {
    const other = await createProject(tk.admin, { name: 'ERP', leadId: id('manager2') });
    const seen = await as(tk.manager).get(`/projects/${other.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.canManage).toBe(false);
    const denied = await as(tk.manager).patch(`/projects/${other.id}`).send({ priority: 'HIGH' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PROJECT_NOT_MANAGED');
    expect((await as(tk.manager).post('/tasks').send({ projectId: other.id, title: 'Some task' })).status).toBe(403);
    expect((await as(tk.manager).post(`/projects/${other.id}/archive`)).status).toBe(403);

    expect((await as(tk.manager2).patch(`/projects/${other.id}`).send({ priority: 'HIGH' })).status).toBe(200); // lead
    expect((await as(tk.admin).patch(`/projects/${other.id}`).send({ priority: 'LOW' })).status).toBe(200); // creator + manage-all
    await as(tk.admin).post(`/projects/${other.id}/members`).send({ membershipIds: [id('manager')] });
    expect((await as(tk.manager).get(`/projects/${other.id}`)).body.data.canManage).toBe(true); // team member
    expect((await as(tk.manager).patch(`/projects/${other.id}`).send({ priority: 'URGENT' })).status).toBe(200);

    const branch = (await as(tk.owner).post('/branches').send({ name: 'Bole', managerId: id('manager') })).body.data;
    const branchProject = await createProject(tk.owner, { name: 'Bole Launch', branchId: branch.id });
    expect((await as(tk.manager).patch(`/projects/${branchProject.id}`).send({ priority: 'HIGH' })).status).toBe(200); // branch manager
  });
});

describe('D-4 completing a project with unfinished tasks', () => {
  it('needs an explicit confirmation, is recorded, and leaves the tasks untouched', async () => {
    const p = await createProject(tk.owner, { name: 'Launch', memberIds: [id('emp')] });
    const t = await createTask(tk.owner, p.id, { title: 'Open item', assigneeId: id('emp') });
    const first = await as(tk.owner).patch(`/projects/${p.id}`).send({ status: 'COMPLETED' });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('PROJECT_HAS_OPEN_TASKS');
    expect(first.body.error.message).toMatch(/1 unfinished task/);

    const confirmed = await as(tk.owner).patch(`/projects/${p.id}`).send({ status: 'COMPLETED', confirmOpenTasks: true });
    expect(confirmed.body.data.status).toBe('COMPLETED');
    expect((await prisma.task.findUnique({ where: { id: t.id } })).status).toBe('TODO');
    const history = (await as(tk.owner).get('/activities')).body.data;
    expect(history.find((a) => a.action === 'PROJECT_STATUS_CHANGED').message).toMatch(/with 1 unfinished task/);
  });
});

describe('D-5 reopening completed tasks', () => {
  it('the assignee can reopen their task; it is recorded as "reopened"', async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp')] });
    const t = await createTask(tk.manager, p.id, { title: 'Report', assigneeId: id('emp') });
    await as(tk.emp).patch(`/tasks/${t.id}`).send({ status: 'COMPLETED' });
    const reopened = await as(tk.emp).patch(`/tasks/${t.id}`).send({ status: 'IN_PROGRESS' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.completedAt).toBeNull();
    const entry = await prisma.activityLog.findFirst({ where: { organizationId: T.org.id, action: 'TASK_REOPENED' } });
    expect(entry).not.toBeNull();
  });
});

describe('D-6 task creation by employees: explicit role permission, only in their projects', () => {
  it('Employee default cannot create; a role with TASK_CREATE can, in projects they are on only', async () => {
    const mine = await createProject(tk.owner, { name: 'Mine', memberIds: [id('emp')] });
    const notMine = await createProject(tk.owner, { name: 'Not mine' });
    expect((await as(tk.emp).post('/tasks').send({ projectId: mine.id, title: 'Some task' })).status).toBe(403);

    const role = (await as(tk.owner).post('/roles').send({ name: 'Contributor', permissions: ['PROJECT_VIEW', 'PROJECT_VIEW_ALL', 'TASK_VIEW', 'TASK_CREATE'] })).body.data;
    await as(tk.owner).patch(`/users/${id('emp')}`).send({ roleId: role.id });
    expect((await as(tk.emp).post('/tasks').send({ projectId: mine.id, title: 'My task' })).status).toBe(201);
    const outside = await as(tk.emp).post('/tasks').send({ projectId: notMine.id, title: 'Some task' }); // visible, not on team
    expect(outside.status).toBe(403);
    expect(outside.body.error.code).toBe('PROJECT_NOT_MANAGED');
  });
});

describe('D-7 ownership transfer and leaving', () => {
  it('transfers ownership with password confirmation and optional step-down', async () => {
    expect((await as(tk.admin).post('/organizations/current/ownership').send({ membershipId: id('manager'), password: PASSWORD })).status).toBe(403);
    expect((await as(tk.owner).post('/organizations/current/ownership').send({ membershipId: id('admin'), password: 'wrong-pass-1' })).status).toBe(422);

    const res = await as(tk.owner).post('/organizations/current/ownership').send({ membershipId: id('admin'), password: PASSWORD, newRoleId: T.roles.ADMIN.id });
    expect(res.status).toBe(200);
    expect(res.body.data.me.workspace.role.key).toBe('ADMIN');
    expect((await prisma.membership.findUnique({ where: { id: id('admin') }, include: { role: true } })).role.key).toBe('OWNER');
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'OWNERSHIP_TRANSFERRED' } })).toBe(1);
  });

  it('the last owner cannot leave; others can, releasing their duties', async () => {
    const last = await as(tk.owner).post('/organizations/current/leave').send({ password: PASSWORD });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_OWNER');

    const led = await createProject(tk.owner, { name: 'Led by Hana', leadId: id('emp') });
    const left = await as(tk.emp).post('/organizations/current/leave').send({ password: PASSWORD });
    expect(left.status).toBe(200);
    expect(left.body.data.me.workspace).toBeNull();
    expect((await prisma.membership.findUnique({ where: { id: id('emp') } })).status).toBe('DEACTIVATED');
    expect((await prisma.project.findUnique({ where: { id: led.id } })).leadId).toBeNull();
    expect((await as(tk.emp).get('/projects')).status).toBe(403);
  });
});

describe('D-9 organization closure request', () => {
  it('owner requests (typed name + password) → renewal stops; withdraw; platform closes and reopens; nothing deleted', async () => {
    expect((await as(tk.admin).post('/organizations/current/closure').send({ confirmName: 'Rules Co', password: PASSWORD })).status).toBe(403);
    expect((await as(tk.owner).post('/organizations/current/closure').send({ confirmName: 'Wrong', password: PASSWORD })).status).toBe(422);

    const requested = await as(tk.owner).post('/organizations/current/closure').send({ reason: 'Moving to another tool', confirmName: 'Rules Co', password: PASSWORD });
    expect(requested.body.data.closureRequest.reason).toBe('Moving to another tool');
    expect((await prisma.subscription.findUnique({ where: { organizationId: T.org.id } })).cancelAtPeriodEnd).toBe(true);
    expect((await as(tk.emp).get('/tasks/my-work')).status).toBe(200); // still working until processed

    await as(tk.owner).delete('/organizations/current/closure');
    expect((await prisma.organization.findUnique({ where: { id: T.org.id } })).closureRequestedAt).toBeNull();
    await as(tk.owner).post('/organizations/current/closure').send({ confirmName: 'Rules Co', password: PASSWORD });

    const admin = await createPlatformAdmin();
    const agent = await platformLogin(admin.email);
    const requests = (await platform(agent).get('/platform/organizations?closureRequested=true')).body.data;
    expect(requests.map((o) => o.name)).toEqual(['Rules Co']);
    await createProject(tk.owner, { name: 'Kept' });
    expect((await platform(agent).patch(`/platform/organizations/${T.org.id}/status`).send({ status: 'CLOSED' })).body.data.status).toBe('CLOSED');
    const blocked = await as(tk.emp).get('/projects');
    expect(blocked.body.error.code).toBe('ORGANIZATION_CLOSED');
    expect(await prisma.project.count({ where: { organizationId: T.org.id } })).toBe(1);

    await platform(agent).patch(`/platform/organizations/${T.org.id}/status`).send({ status: 'ACTIVE' });
    expect((await as(tk.emp).get('/tasks/my-work')).status).toBe(200);
    expect((await prisma.organization.findUnique({ where: { id: T.org.id } })).closureRequestedAt).toBeNull();
  });
});

describe('D-10 admins manage admins within their own permissions', () => {
  it('an admin may change another admin, but never into a role above their own permissions', async () => {
    expect((await as(tk.admin).patch(`/users/${id('admin2')}`).send({ roleId: T.roles.MANAGER.id })).status).toBe(200);
    const powerful = (await as(tk.owner).post('/roles').send({ name: 'Billing lead', permissions: ['BILLING_VIEW', 'BILLING_MANAGE'] })).body.data;
    const res = await as(tk.admin).patch(`/users/${id('manager')}`).send({ roleId: powerful.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });
});

describe('D-11 archived projects: read-only history', () => {
  it('tasks stay visible on the project, are excluded from My Work, and cannot be changed', async () => {
    const p = await createProject(tk.manager, { name: 'Done Q3', memberIds: [id('emp')] });
    const t = await createTask(tk.manager, p.id, { title: 'Wrap up', assigneeId: id('emp') });
    await as(tk.manager).post(`/projects/${p.id}/archive`);

    const onProject = await as(tk.emp).get(`/tasks?projectId=${p.id}`);
    expect(onProject.body.data.map((x) => x.title)).toEqual(['Wrap up']);
    expect(onProject.body.data[0].project.archived).toBe(true);
    expect((await as(tk.emp).get(`/tasks/${t.id}`)).status).toBe(200);
    const work = (await as(tk.emp).get('/tasks/my-work')).body.data;
    expect([...work.overdue, ...work.today, ...work.upcoming].map((x) => x.id)).not.toContain(t.id);
    expect((await as(tk.emp).get('/tasks')).body.data.map((x) => x.id)).not.toContain(t.id);
    expect((await as(tk.emp).get('/tasks?includeArchived=true')).body.data.map((x) => x.id)).toContain(t.id);

    const change = await as(tk.emp).patch(`/tasks/${t.id}`).send({ status: 'COMPLETED' });
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe('PROJECT_ARCHIVED');
    expect((await as(tk.admin).delete(`/tasks/${t.id}`)).status).toBe(409);
  });
});

describe('D-13 suspended company: billing only, for the billing manager', () => {
  it('the owner can see and pay; nothing else opens; admins and closed companies get nothing', async () => {
    await prisma.organization.update({ where: { id: T.org.id }, data: { status: 'SUSPENDED' } });
    const me = (await as(tk.owner).get('/auth/me')).body.data;
    expect(me.workspace).toBeNull();
    expect(me.blockedWorkspace).toMatchObject({ organization: { name: 'Rules Co' }, canResolveBilling: true });
    expect((await as(tk.owner).get('/subscription')).status).toBe(200);
    expect((await as(tk.owner).get('/organizations/current')).status).toBe(200);
    expect((await as(tk.owner).get('/payments')).status).toBe(200);
    const checkout = await as(tk.owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id });
    expect(checkout.status).toBe(201);
    expect((await as(tk.owner).get('/projects')).body.error.code).toBe('ORGANIZATION_SUSPENDED');

    expect((await as(tk.admin).get('/auth/me')).body.data.blockedWorkspace.canResolveBilling).toBe(false);
    expect((await as(tk.admin).get('/subscription')).body.error.code).toBe('ORGANIZATION_SUSPENDED');

    // Paying doesn't reactivate: the platform sees "paid while suspended" and decides.
    const agent = await platformLogin((await createPlatformAdmin()).email);
    expect((await platform(agent).get('/platform/overview')).body.data.paidWhileSuspended).toBe(1);
    expect((await prisma.organization.findUnique({ where: { id: T.org.id } })).status).toBe('SUSPENDED');

    await prisma.organization.update({ where: { id: T.org.id }, data: { status: 'CLOSED' } });
    expect((await as(tk.owner).get('/subscription')).body.error.code).toBe('ORGANIZATION_CLOSED');
  });
});

describe('F-01 branch managers can pick members, whatever their role', () => {
  it('an employee who manages a branch can load the member list; other employees cannot', async () => {
    expect((await as(tk.emp).get('/users/options')).status).toBe(403);
    const branch = (await as(tk.owner).post('/branches').send({ name: 'CMC', managerId: id('emp') })).body.data;
    const list = await as(tk.emp).get('/users/options');
    expect(list.status).toBe(200);
    expect(Object.keys(list.body.data[0]).sort()).toEqual(['email', 'id', 'jobTitle', 'name', 'role']);
    expect((await as(tk.emp).post(`/branches/${branch.id}/members`).send({ membershipIds: [id('manager')] })).status).toBe(200);
  });
});

describe('F-02 deactivating someone releases their manager and lead duties', () => {
  it('responsibilities are listed first; deactivation clears them, records it, and keeps tasks assigned', async () => {
    const branch = (await as(tk.owner).post('/branches').send({ name: 'Sar Bet', managerId: id('manager') })).body.data;
    const project = await createProject(tk.owner, { name: 'Led', leadId: id('manager') });
    const task = await createTask(tk.owner, project.id, { title: 'Open', assigneeId: id('manager') });

    const resp = (await as(tk.admin).get(`/users/${id('manager')}/responsibilities`)).body.data;
    expect(resp).toEqual({ managedBranches: [{ id: branch.id, name: 'Sar Bet' }], ledProjects: [{ id: project.id, name: 'Led' }], openTasks: 1 });
    expect((await as(tk.emp).get(`/users/${id('manager')}/responsibilities`)).status).toBe(403);

    await as(tk.admin).patch(`/users/${id('manager')}`).send({ status: 'DEACTIVATED' });
    expect((await prisma.branch.findUnique({ where: { id: branch.id } })).managerId).toBeNull();
    expect((await prisma.project.findUnique({ where: { id: project.id } })).leadId).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: task.id } })).assigneeId).toBe(id('manager'));
    const entry = (await as(tk.owner).get('/activities')).body.data.find((a) => a.action === 'DUTIES_RELEASED');
    expect(entry.message).toMatch(/manager of Sar Bet; lead of Led/);
  });
});
