import { beforeEach, describe, expect, it } from 'vitest';
import { as, createProject, createTask, createTenant, login, prisma, resetDb } from './helpers.js';

let T, tokens;

beforeEach(async () => {
  await resetDb();
  await prisma.subscriptionPlan.update({ where: { code: 'FREE' }, data: { maxUsers: 20 } }); // limits are not under test here
  T = await createTenant({
    members: [
      { key: 'admin', role: 'ADMIN' },
      { key: 'manager', role: 'MANAGER' },
      { key: 'employee', role: 'EMPLOYEE' },
      { key: 'employee2', role: 'EMPLOYEE' },
    ],
  });
  tokens = {
    owner: await login(T.owner.user.email),
    admin: await login(T.members.admin.user.email),
    manager: await login(T.members.manager.user.email),
    employee: await login(T.members.employee.user.email),
  };
});

const invite = (token, roleId, email = `invitee-${Math.random().toString(36).slice(2)}@example.com`) =>
  as(token).post('/users').send({ email, firstName: 'New', lastName: 'Member', roleId });

describe('billing and subscription boundaries', () => {
  it('employee cannot access billing', async () => {
    expect((await as(tokens.employee).get('/payments')).status).toBe(403);
    expect((await as(tokens.employee).get('/subscription')).status).toBe(403);
  });

  it('manager cannot change the subscription or pay', async () => {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    expect((await as(tokens.manager).post('/payments/checkout').send({ planId: plan.id })).status).toBe(403);
    expect((await as(tokens.manager).post('/subscription/cancel')).status).toBe(403);
  });

  it('admin can view but not manage the subscription', async () => {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    expect((await as(tokens.admin).get('/subscription')).status).toBe(200);
    expect((await as(tokens.admin).post('/payments/checkout').send({ planId: plan.id })).status).toBe(403);
  });

  it('owner can start a checkout', async () => {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    const res = await as(tokens.owner).post('/payments/checkout').send({ planId: plan.id });
    expect(res.status).toBe(201);
    expect(res.body.data.amountCents).toBe(plan.priceCents);
  });
});

describe('user management', () => {
  it('owner can invite a user', async () => {
    const res = await invite(tokens.owner, T.roles.MANAGER.id);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('INVITED');
  });

  it('admin can invite a user with a role within their own permissions', async () => {
    const res = await invite(tokens.admin, T.roles.EMPLOYEE.id);
    expect(res.status).toBe(201);
  });

  it('admin cannot grant the Owner role (no owner-level authority)', async () => {
    const res = await invite(tokens.admin, T.roles.OWNER.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');

    const promote = await as(tokens.admin).patch(`/users/${T.members.manager.membership.id}`).send({ roleId: T.roles.OWNER.id });
    expect(promote.status).toBe(403);
  });

  it('admin cannot deactivate or demote an owner', async () => {
    const res = await as(tokens.admin).patch(`/users/${T.owner.membership.id}`).send({ roleId: T.roles.EMPLOYEE.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OWNER_PROTECTED');
    expect((await as(tokens.admin).delete(`/users/${T.owner.membership.id}`)).status).toBe(403);
  });

  it('nobody can change their own role', async () => {
    const res = await as(tokens.admin).patch(`/users/${T.members.admin.membership.id}`).send({ roleId: T.roles.OWNER.id });
    expect(res.status).toBe(403);
  });

  it('employee and manager cannot invite users', async () => {
    expect((await invite(tokens.employee, T.roles.EMPLOYEE.id)).status).toBe(403);
    expect((await invite(tokens.manager, T.roles.EMPLOYEE.id)).status).toBe(403);
  });

  it('only an owner can make someone an owner, and owners can manage each other', async () => {
    const promote = await as(tokens.owner).patch(`/users/${T.members.admin.membership.id}`).send({ roleId: T.roles.OWNER.id });
    expect(promote.status).toBe(200);
    expect(promote.body.data.role.key).toBe('OWNER');

    const demote = await as(tokens.admin).patch(`/users/${T.owner.membership.id}`).send({ roleId: T.roles.ADMIN.id });
    expect(demote.status).toBe(200); // the promoted member is now an owner too
  });
});

describe('roles and permissions', () => {
  it('the Owner role is locked', async () => {
    const res = await as(tokens.owner).patch(`/roles/${T.roles.OWNER.id}`).send({ permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_LOCKED');
  });

  it('admin cannot modify roles (unauthorized role modification)', async () => {
    const res = await as(tokens.admin).patch(`/roles/${T.roles.EMPLOYEE.id}`).send({ permissions: ['BILLING_MANAGE'] });
    expect(res.status).toBe(403);
    const perms = await prisma.rolePermission.count({ where: { roleId: T.roles.EMPLOYEE.id } });
    expect(perms).toBe(2);
  });

  it('an owner on the Free plan can create a role with its own permissions and assign it (PDF §04)', async () => {
    const created = await as(tokens.owner).post('/roles').send({ name: 'Auditor', description: 'Reviews history', permissions: ['ACTIVITY_VIEW', 'PROJECT_VIEW', 'TASK_VIEW'] });
    expect(created.status).toBe(201);
    expect(created.body.data.permissions).toEqual(['ACTIVITY_VIEW', 'PROJECT_VIEW', 'TASK_VIEW']);

    const assigned = await as(tokens.owner).patch(`/users/${T.members.employee2.membership.id}`).send({ roleId: created.body.data.id });
    expect(assigned.status).toBe(200);
    const token = await login(T.members.employee2.user.email);
    expect((await as(token).get('/activities')).status).toBe(200); // permission granted by the custom role
    expect((await as(token).get('/payments')).status).toBe(403); // and nothing more
  });

  it('the owner manages organization settings; admins and managers cannot', async () => {
    const renamed = await as(tokens.owner).patch('/organizations/current').send({ name: 'Renamed Trading PLC' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Renamed Trading PLC');
    expect((await as(tokens.admin).patch('/organizations/current').send({ name: 'Admin Rename' })).status).toBe(403);
    expect((await as(tokens.manager).patch('/organizations/current').send({ name: 'Manager Rename' })).status).toBe(403);
    const history = await as(tokens.owner).get('/activities?entityType=ORGANIZATION');
    expect(history.body.data[0].message).toBe('renamed the organization to "Renamed Trading PLC"');
  });

  it('only roles holders with ROLE_CREATE can create roles', async () => {
    expect((await as(tokens.admin).post('/roles').send({ name: 'Sneaky', permissions: ['TASK_VIEW'] })).status).toBe(403);
    expect((await as(tokens.manager).post('/roles').send({ name: 'Sneaky', permissions: ['TASK_VIEW'] })).status).toBe(403);
  });

  it('role permission changes apply immediately to signed-in users', async () => {
    expect((await as(tokens.employee).get('/activities')).status).toBe(403);
    const res = await as(tokens.owner).patch(`/roles/${T.roles.EMPLOYEE.id}`).send({ permissions: ['PROJECT_VIEW', 'TASK_VIEW', 'ACTIVITY_VIEW'] });
    expect(res.status).toBe(200);
    expect((await as(tokens.employee).get('/activities')).status).toBe(200); // same token, new rights
  });

  it('a deactivated member loses access on their very next request', async () => {
    expect((await as(tokens.employee).get('/tasks')).status).toBe(200);
    await as(tokens.owner).patch(`/users/${T.members.employee.membership.id}`).send({ status: 'DEACTIVATED' });
    const res = await as(tokens.employee).get('/tasks');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MEMBERSHIP_INACTIVE');
  });
});

describe('project and task permissions', () => {
  it('employee cannot create projects or tasks', async () => {
    expect((await as(tokens.employee).post('/projects').send({ name: 'Nope' })).status).toBe(403);
    const project = await createProject(tokens.manager, { memberIds: [T.members.employee.membership.id] });
    expect((await as(tokens.employee).post('/tasks').send({ projectId: project.id, title: 'Nope' })).status).toBe(403);
  });

  it('employees only see projects they are on', async () => {
    const mine = await createProject(tokens.manager, { name: 'Mine', memberIds: [T.members.employee.membership.id] });
    const other = await createProject(tokens.manager, { name: 'Other' });
    const list = await as(tokens.employee).get('/projects');
    expect(list.body.data.map((p) => p.id)).toEqual([mine.id]);
    expect((await as(tokens.employee).get(`/projects/${other.id}`)).status).toBe(404);
  });

  it("employee can update the status of their own task but nothing else", async () => {
    const project = await createProject(tokens.manager, { memberIds: [T.members.employee.membership.id, T.members.employee2.membership.id] });
    const mine = await createTask(tokens.manager, project.id, { assigneeId: T.members.employee.membership.id });
    const theirs = await createTask(tokens.manager, project.id, { assigneeId: T.members.employee2.membership.id });
    const api = as(tokens.employee);

    const progress = await api.patch(`/tasks/${mine.id}`).send({ status: 'COMPLETED' });
    expect(progress.status).toBe(200);
    expect(progress.body.data.completedAt).not.toBeNull();

    expect((await api.patch(`/tasks/${mine.id}`).send({ title: 'Renamed' })).status).toBe(403);
    expect((await api.patch(`/tasks/${mine.id}`).send({ assigneeId: T.members.employee2.membership.id })).status).toBe(403);
    expect((await api.patch(`/tasks/${theirs.id}`).send({ status: 'COMPLETED' })).status).toBe(403);
    expect((await api.delete(`/tasks/${mine.id}`)).status).toBe(403);
  });

  it('completing a task is recorded in the activity history', async () => {
    const project = await createProject(tokens.manager, { memberIds: [T.members.employee.membership.id] });
    const task = await createTask(tokens.manager, project.id, { title: 'Create Login', assigneeId: T.members.employee.membership.id });
    await as(tokens.employee).patch(`/tasks/${task.id}`).send({ status: 'COMPLETED' });

    const history = await as(tokens.manager).get('/activities');
    const entry = history.body.data.find((a) => a.action === 'TASK_COMPLETED');
    expect(entry.message).toBe('completed "Create Login"');
    expect(entry.actor.id).toBe(T.members.employee.membership.id);
  });

  it('D-12: a task can only be assigned to someone already on the project team', async () => {
    const project = await createProject(tokens.manager);
    const refused = await as(tokens.manager).post('/tasks').send({ projectId: project.id, title: 'Cross-team', assigneeId: T.members.employee2.membership.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details[0]).toMatchObject({ field: 'assigneeId', message: 'Add this person to the project team first' });
    await as(tokens.manager).post(`/projects/${project.id}/members`).send({ membershipIds: [T.members.employee2.membership.id] });
    expect((await as(tokens.manager).post('/tasks').send({ projectId: project.id, title: 'Cross-team', assigneeId: T.members.employee2.membership.id })).status).toBe(201);
  });

  it('deactivated members cannot receive new assignments but keep their history', async () => {
    const project = await createProject(tokens.manager, { memberIds: [T.members.employee2.membership.id] });
    const task = await createTask(tokens.manager, project.id, { assigneeId: T.members.employee2.membership.id });
    await as(tokens.owner).patch(`/users/${T.members.employee2.membership.id}`).send({ status: 'DEACTIVATED' });

    const kept = await as(tokens.manager).get(`/tasks/${task.id}`);
    expect(kept.body.data.assignee.status).toBe('DEACTIVATED');
    const reassign = await createTask(tokens.manager, project.id).then((t) =>
      as(tokens.manager).patch(`/tasks/${t.id}`).send({ assigneeId: T.members.employee2.membership.id }),
    );
    expect(reassign.status).toBe(422);
  });
});
