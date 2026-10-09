import { beforeEach, describe, expect, it } from 'vitest';
import { as, createProject, createTask, createTenant, login, prisma, resetDb } from './helpers.js';

/**
 * Two tenants, A and B. Every test has a user of A trying to reach B's data by guessing,
 * copying or tampering with ids. The expected answer is always "not found" (404): another
 * organization's records must be indistinguishable from records that do not exist.
 */
let A, B, tokenA, tokenB, projectB, taskB;

beforeEach(async () => {
  await resetDb();
  A = await createTenant({ name: 'Abay Trading PLC', members: [{ key: 'emp', role: 'EMPLOYEE' }] });
  B = await createTenant({ name: 'Gift Construction PLC', members: [{ key: 'emp', role: 'EMPLOYEE' }] });
  tokenA = await login(A.owner.user.email);
  tokenB = await login(B.owner.user.email);
  projectB = await createProject(tokenB, { name: 'Bole Apartment Block' });
  taskB = await createTask(tokenB, projectB.id, { title: 'Site safety audit', assigneeId: B.members.emp.membership.id });
});

describe('cross-tenant object access', () => {
  it("Tenant A cannot read, edit, archive or delete Tenant B's project", async () => {
    const api = as(tokenA);
    expect((await api.get(`/projects/${projectB.id}`)).status).toBe(404);
    expect((await api.patch(`/projects/${projectB.id}`).send({ name: 'Hijacked' })).status).toBe(404);
    expect((await api.post(`/projects/${projectB.id}/archive`)).status).toBe(404);
    expect((await api.delete(`/projects/${projectB.id}`)).status).toBe(404);
    expect((await api.get(`/projects/${projectB.id}/activity`)).status).toBe(404);

    const still = await prisma.project.findUnique({ where: { id: projectB.id } });
    expect(still.name).toBe('Bole Apartment Block');
    expect(still.archivedAt).toBeNull();
  });

  it("Tenant A cannot read, update or delete Tenant B's task by guessing its id", async () => {
    const api = as(tokenA);
    expect((await api.get(`/tasks/${taskB.id}`)).status).toBe(404);
    expect((await api.patch(`/tasks/${taskB.id}`).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await api.delete(`/tasks/${taskB.id}`)).status).toBe(404);
    expect((await prisma.task.findUnique({ where: { id: taskB.id } })).status).toBe('TODO');
  });

  it("Tenant A cannot create a task inside Tenant B's project", async () => {
    const res = await as(tokenA).post('/tasks').send({ projectId: projectB.id, title: 'Sneaky task' });
    expect(res.status).toBe(422);
    expect(await prisma.task.count({ where: { projectId: projectB.id } })).toBe(1);
  });

  it("Tenant A cannot assign work to Tenant B's members", async () => {
    const projectA = await createProject(tokenA);
    const outsider = B.members.emp.membership.id;

    const create = await as(tokenA).post('/tasks').send({ projectId: projectA.id, title: 'Cross-tenant', assigneeId: outsider });
    expect(create.status).toBe(422);

    const taskA = await createTask(tokenA, projectA.id);
    const update = await as(tokenA).patch(`/tasks/${taskA.id}`).send({ assigneeId: outsider });
    expect(update.status).toBe(422);

    const lead = await as(tokenA).patch(`/projects/${projectA.id}`).send({ leadId: outsider });
    expect(lead.status).toBe(422);

    const team = await as(tokenA).post(`/projects/${projectA.id}/members`).send({ membershipIds: [outsider] });
    expect(team.status).toBe(422);
  });

  it('the database itself rejects a task whose organization differs from its project', async () => {
    await expect(
      prisma.task.create({ data: { organizationId: A.org.id, projectId: projectB.id, title: 'Bypass the API' } }),
    ).rejects.toThrow();
  });

  it("Tenant A cannot change or remove Tenant B's members or give them its roles", async () => {
    const api = as(tokenA);
    const bMember = B.members.emp.membership.id;
    expect((await api.patch(`/users/${bMember}`).send({ status: 'DEACTIVATED' })).status).toBe(404);
    expect((await api.delete(`/users/${bMember}`)).status).toBe(404);

    // Using B's role id while inviting into A is rejected.
    const res = await api.post('/users').send({ email: 'x@example.com', firstName: 'X', lastName: 'Y', roleId: B.roles.ADMIN.id });
    expect(res.status).toBe(422);
  });

  it("Tenant A cannot edit Tenant B's roles", async () => {
    const res = await as(tokenA).patch(`/roles/${B.roles.EMPLOYEE.id}`).send({ permissions: ['BILLING_MANAGE'] });
    expect(res.status).toBe(404);
  });
});

describe('scoped lists, search, dashboard and history', () => {
  it('lists, search and dashboard counts only include the own organization', async () => {
    await createProject(tokenA, { name: 'Website Development' });
    const api = as(tokenA);

    const projects = await api.get('/projects');
    expect(projects.body.data.map((p) => p.name)).toEqual(['Website Development']);

    const tasks = await api.get('/tasks');
    expect(tasks.body.data.find((t) => t.id === taskB.id)).toBeUndefined();

    const members = await api.get('/users');
    expect(members.body.data.map((m) => m.email)).not.toContain(B.owner.user.email);

    const search = await api.get('/dashboard/search?q=Bole');
    expect(search.body.data.projects).toHaveLength(0);
    expect(search.body.data.tasks).toHaveLength(0);

    const dashboard = await api.get('/dashboard');
    expect(dashboard.body.data.stats.totalProjects).toBe(1);
    expect(dashboard.body.data.stats.openTasks).toBe(0);
  });

  it('ignores an organizationId smuggled into query strings and rejects it in bodies', async () => {
    const list = await as(tokenA).get(`/projects?organizationId=${B.org.id}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);

    const create = await as(tokenA).post('/projects').send({ name: 'Smuggled', organizationId: B.org.id });
    expect(create.status).toBe(422);
    expect(await prisma.project.count({ where: { organizationId: B.org.id } })).toBe(1);
  });

  it("activity history and payments are scoped to the caller's organization", async () => {
    const activities = await as(tokenA).get('/activities?pageSize=100');
    expect(activities.status).toBe(200);
    const ids = new Set((await prisma.activityLog.findMany({ where: { organizationId: B.org.id } })).map((a) => a.id));
    expect(activities.body.data.some((a) => ids.has(a.id))).toBe(false);

    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    const checkout = await as(tokenB).post('/payments/checkout').send({ planId: plan.id });
    const { txRef } = checkout.body.data;
    expect((await as(tokenA).get(`/payments/${txRef}`)).status).toBe(404);
    expect((await as(tokenA).post(`/payments/${txRef}/verify`)).status).toBe(404);
    expect((await prisma.payment.findUnique({ where: { txRef } })).status).toBe('PENDING');
  });
});

describe("filters and side doors with another tenant's ids", () => {
  it('list filters given foreign ids return nothing from the other tenant', async () => {
    const api = as(tokenA);
    const bMember = B.members.emp.membership.id;

    const tasks = await api.get(`/tasks?projectId=${projectB.id}`);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data).toHaveLength(0);
    expect((await api.get(`/tasks?assigneeId=${bMember}`)).body.data).toHaveLength(0);

    expect((await api.get(`/activities?projectId=${projectB.id}`)).body.data).toHaveLength(0);
    expect((await api.get(`/activities?actorId=${B.owner.membership.id}`)).body.data).toHaveLength(0);
    expect((await api.get(`/activities?entityId=${taskB.id}`)).body.data).toHaveLength(0);
    expect((await api.get(`/users?roleId=${B.roles.EMPLOYEE.id}`)).body.data).toHaveLength(0);
    expect((await api.get(`/projects?leadId=${bMember}`)).body.data).toHaveLength(0);
  });

  it("cannot delete another tenant's role or touch its payments", async () => {
    expect((await as(tokenA).delete(`/roles/${B.roles.EMPLOYEE.id}`)).status).toBe(404);

    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    const { txRef } = (await as(tokenB).post('/payments/checkout').send({ planId: plan.id })).body.data;
    expect((await as(tokenA).post(`/payments/${txRef}/verify`)).status).toBe(404);
    expect((await as(tokenA).post(`/payments/${txRef}/cancel`)).status).toBe(404);
    expect((await prisma.payment.findUnique({ where: { txRef } })).status).toBe('PENDING');

    const payments = await as(tokenA).get('/payments');
    expect(payments.body.data.find((p) => p.txRef === txRef)).toBeUndefined();
  });

  it("a tenant's subscription and dashboard reflect only its own usage", async () => {
    const sub = await as(tokenA).get('/subscription');
    expect(sub.body.data.usage).toEqual({ users: 2, projects: 0 });
  });
});

describe('workspace switching', () => {
  it('only allows switching into workspaces the user belongs to', async () => {
    const res = await as(tokenA).post('/auth/switch-workspace').send({ membershipId: B.owner.membership.id });
    expect(res.status).toBe(404);
  });
});
