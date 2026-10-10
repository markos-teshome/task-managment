import { beforeEach, describe, expect, it } from 'vitest';
import { as, createProject, createTask, createTenant, login, prisma, resetDb } from './helpers.js';

let A, owner, admin, manager, emp, plans;

/** Branch limits come from the plan; most tests need room for several branches. */
const usePlan = (orgId, code) =>
  prisma.subscription.update({
    where: { organizationId: orgId },
    data: { planId: plans[code].id, currentPeriodEnd: code === 'FREE' ? null : new Date(Date.now() + 30 * 86_400_000) },
  });

const createBranch = async (token, body) => {
  const res = await as(token).post('/branches').send(body);
  if (res.status !== 201) throw new Error(`createBranch failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
};

beforeEach(async () => {
  await resetDb();
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  A = await createTenant({
    name: 'Abay Trading PLC',
    members: [
      { key: 'admin', role: 'ADMIN' },
      { key: 'manager', role: 'MANAGER' },
      { key: 'manager2', role: 'MANAGER' },
      { key: 'emp', role: 'EMPLOYEE' },
    ],
  });
  await usePlan(A.org.id, 'BUSINESS');
  [owner, admin, manager, emp] = await Promise.all(['owner', 'admin', 'manager', 'emp'].map((k) => login((k === 'owner' ? A.owner : A.members[k]).user.email)));
});

describe('default branch and creation', () => {
  it('every organization starts with one default "Head Office" branch', async () => {
    const list = await as(owner).get('/branches');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'Head Office', isDefault: true, status: 'ACTIVE' });
  });

  it('the owner creates a branch with a manager, who becomes a member of it', async () => {
    const b = await createBranch(owner, { name: '  Bole   Branch ', code: 'bole', address: 'Bole Road', managerId: A.members.manager.membership.id });
    expect(b).toMatchObject({ name: 'Bole Branch', code: 'BOLE', isDefault: false, manager: { id: A.members.manager.membership.id } });
    expect(b.members.map((m) => m.membershipId)).toEqual([A.members.manager.membership.id]);
    expect(await prisma.activityLog.count({ where: { organizationId: A.org.id, action: 'BRANCH_CREATED' } })).toBe(1);
  });

  it('names and codes are unique within the organization only', async () => {
    await createBranch(owner, { name: 'Bole Branch', code: 'BOLE' });
    const dup = await as(owner).post('/branches').send({ name: 'Bole Branch' });
    expect(dup.status).toBe(422);
    expect(dup.body.error.details[0].field).toBe('name');
    const B = await createTenant({ name: 'Gift Construction PLC' });
    await usePlan(B.org.id, 'BUSINESS');
    expect((await as(await login(B.owner.user.email)).post('/branches').send({ name: 'Bole Branch', code: 'BOLE' })).status).toBe(201);
  });

  it('only BRANCH_MANAGE holders create branches; a manager must be an active member of the same organization', async () => {
    expect((await as(manager).post('/branches').send({ name: 'Nope' })).status).toBe(403);
    expect((await as(emp).post('/branches').send({ name: 'Nope' })).status).toBe(403);
    expect((await as(admin).post('/branches').send({ name: 'By Admin' })).status).toBe(201);
    const B = await createTenant({ name: 'Gift Construction PLC' });
    const foreign = await as(owner).post('/branches').send({ name: 'X', managerId: B.owner.membership.id });
    expect(foreign.status).toBe(422);
  });
});

describe('branch membership and branch managers', () => {
  it('an employee can belong to two branches', async () => {
    const b1 = await createBranch(owner, { name: 'Bole Branch' });
    const b2 = await createBranch(owner, { name: 'CMC Branch' });
    for (const b of [b1, b2]) {
      expect((await as(owner).post(`/branches/${b.id}/members`).send({ membershipIds: [A.members.emp.membership.id] })).status).toBe(200);
    }
    const mine = (await as(emp).get('/branches')).body.data.map((b) => b.name).sort();
    expect(mine).toEqual(['Bole Branch', 'CMC Branch']); // employees see only their branches
  });

  it('a branch manager manages their own branch only, and only description/address and members', async () => {
    const mine = await createBranch(owner, { name: 'Bole Branch', managerId: A.members.manager.membership.id });
    const other = await createBranch(owner, { name: 'CMC Branch', managerId: A.members.manager2.membership.id });

    expect((await as(manager).patch(`/branches/${mine.id}`).send({ description: 'Airport side' })).status).toBe(200);
    expect((await as(manager).post(`/branches/${mine.id}/members`).send({ membershipIds: [A.members.emp.membership.id] })).status).toBe(200);
    expect((await as(manager).patch(`/branches/${mine.id}`).send({ name: 'Renamed' })).status).toBe(403);
    expect((await as(manager).patch(`/branches/${mine.id}`).send({ status: 'INACTIVE' })).status).toBe(403);

    expect((await as(manager).patch(`/branches/${other.id}`).send({ description: 'x' })).status).toBe(403);
    expect((await as(manager).post(`/branches/${other.id}/members`).send({ membershipIds: [A.members.emp.membership.id] })).status).toBe(403);
    expect((await as(manager).delete(`/branches/${other.id}/members/${A.members.manager2.membership.id}`)).status).toBe(403);
  });

  it("the branch manager can't be removed from the branch without a new manager", async () => {
    const b = await createBranch(owner, { name: 'Bole Branch', managerId: A.members.manager.membership.id });
    const res = await as(owner).delete(`/branches/${b.id}/members/${A.members.manager.membership.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_MANAGER_REQUIRED');
  });
});

describe('cross-organization protection', () => {
  it("branches, branch members and branch projects never cross organizations", async () => {
    const B = await createTenant({ name: 'Gift Construction PLC' });
    await usePlan(B.org.id, 'BUSINESS');
    const otherOwner = await login(B.owner.user.email);
    const theirs = await createBranch(otherOwner, { name: 'Gift Site' });
    const ours = await createBranch(owner, { name: 'Bole Branch' });

    expect((await as(owner).get(`/branches/${theirs.id}`)).status).toBe(404);
    expect((await as(owner).patch(`/branches/${theirs.id}`).send({ description: 'x' })).status).toBe(404);
    expect((await as(owner).post(`/branches/${theirs.id}/members`).send({ membershipIds: [A.members.emp.membership.id] })).status).toBe(404);
    // Their member into our branch → rejected like an unknown id.
    expect((await as(owner).post(`/branches/${ours.id}/members`).send({ membershipIds: [B.owner.membership.id] })).status).toBe(422);
    // A project cannot be placed in another organization's branch.
    expect((await as(owner).post('/projects').send({ name: 'P', branchId: theirs.id })).status).toBe(422);
    expect((await as(otherOwner).get('/branches')).body.data.map((b) => b.name)).not.toContain('Bole Branch');
  });

  it('the database itself refuses a branch member or branch project from another organization', async () => {
    const B = await createTenant({ name: 'Gift Construction PLC' });
    const ours = await createBranch(owner, { name: 'Bole Branch' });
    await expect(
      prisma.branchMembership.create({ data: { branchId: ours.id, membershipId: B.owner.membership.id, organizationId: A.org.id } }),
    ).rejects.toThrow();
    const theirProject = await prisma.project.create({ data: { organizationId: B.org.id, name: 'Theirs' } });
    await expect(prisma.project.update({ where: { id: theirProject.id }, data: { branchId: ours.id } })).rejects.toThrow();
  });
});

describe('project visibility with branches (tasks inherit it)', () => {
  let bole, cmc, cmcProject, orgWide;
  beforeEach(async () => {
    bole = await createBranch(owner, { name: 'Bole Branch', managerId: A.members.manager.membership.id });
    cmc = await createBranch(owner, { name: 'CMC Branch' });
    await createProject(owner, { name: 'Bole Launch', branchId: bole.id });
    cmcProject = await createProject(owner, { name: 'CMC Audit', branchId: cmc.id });
    orgWide = await createProject(owner, { name: 'Company Website' });
    await createTask(owner, cmcProject.id, { title: 'CMC stock count' });
  });

  it('owners and admins (BRANCH_MANAGE) see every project', async () => {
    for (const token of [owner, admin]) {
      expect((await as(token).get('/projects')).body.data.map((p) => p.name).sort()).toEqual(['Bole Launch', 'CMC Audit', 'Company Website']);
    }
  });

  it("a manager sees organization-wide projects and their own branch's, not other branches'", async () => {
    const names = (await as(manager).get('/projects')).body.data.map((p) => p.name).sort();
    expect(names).toEqual(['Bole Launch', 'Company Website']);
    expect((await as(manager).get(`/projects/${cmcProject.id}`)).status).toBe(404);
    // Search must not widen the scope.
    expect((await as(manager).get('/projects?search=CMC')).body.data).toEqual([]);
    // Tasks of hidden projects stay hidden, in lists and search.
    expect((await as(manager).get('/tasks')).body.data.map((t) => t.title)).not.toContain('CMC stock count');
    expect((await as(manager).get('/dashboard/search?q=CMC')).body.data.tasks ?? []).toEqual([]);
    // The history doesn't reveal the other branch's project either.
    const history = JSON.stringify((await as(manager).get('/activities')).body.data);
    expect(history).not.toContain('CMC Audit');
  });

  it('an organization-wide project is not visible to everyone: employees still need to be on the team', async () => {
    expect((await as(emp).get('/projects')).body.data).toEqual([]);
    expect((await as(emp).get(`/projects/${orgWide.id}`)).status).toBe(404);
    await as(owner).post(`/projects/${orgWide.id}/members`).send({ membershipIds: [A.members.emp.membership.id] });
    expect((await as(emp).get('/projects')).body.data.map((p) => p.name)).toEqual(['Company Website']);
  });

  it('a project can only be put in a branch the creator works in (unless BRANCH_MANAGE)', async () => {
    expect((await as(manager).post('/projects').send({ name: 'Mine', branchId: bole.id })).status).toBe(201);
    const res = await as(manager).post('/projects').send({ name: 'Not mine', branchId: cmc.id });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('branchId');
    expect((await as(manager).get(`/projects?branchId=${bole.id}`)).body.data.map((p) => p.name).sort()).toEqual(['Bole Launch', 'Mine']);
    expect((await as(manager).get('/projects?branchId=none')).body.data.map((p) => p.name)).toEqual(['Company Website']);
  });
});

describe('archiving branches keeps history intact', () => {
  it('the default branch cannot be archived until another branch is the default', async () => {
    const [hq] = (await as(owner).get('/branches')).body.data;
    const res = await as(owner).patch(`/branches/${hq.id}`).send({ status: 'INACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEFAULT_BRANCH_REQUIRED');

    const bole = await createBranch(owner, { name: 'Bole Branch' });
    expect((await as(owner).patch(`/branches/${bole.id}`).send({ isDefault: true })).status).toBe(200);
    expect((await as(owner).patch(`/branches/${hq.id}`).send({ status: 'INACTIVE' })).status).toBe(200);
    expect(await prisma.branch.count({ where: { organizationId: A.org.id, isDefault: true } })).toBe(1);
  });

  it('active projects must be moved before archiving; archived projects, members and activity keep their link', async () => {
    const bole = await createBranch(owner, { name: 'Bole Branch', managerId: A.members.manager.membership.id });
    const cmc = await createBranch(owner, { name: 'CMC Branch' });
    const live = await createProject(owner, { name: 'Live Project', branchId: bole.id });
    const old = await createProject(owner, { name: 'Old Project', branchId: bole.id });
    await as(owner).post(`/projects/${old.id}/archive`);

    const refused = await as(owner).patch(`/branches/${bole.id}`).send({ status: 'INACTIVE' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('BRANCH_HAS_ACTIVE_PROJECTS');

    const archived = await as(owner).patch(`/branches/${bole.id}`).send({ status: 'INACTIVE', reassignProjectsTo: cmc.id });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('INACTIVE');
    expect((await prisma.project.findUnique({ where: { id: live.id } })).branchId).toBe(cmc.id);
    expect((await prisma.project.findUnique({ where: { id: old.id } })).branchId).toBe(bole.id); // history untouched
    expect(await prisma.branchMembership.count({ where: { branchId: bole.id } })).toBe(1);
    expect(await prisma.branch.count({ where: { id: bole.id } })).toBe(1); // never deleted

    // Inactive branches accept no new members or projects; reactivation works.
    expect((await as(owner).post(`/branches/${bole.id}/members`).send({ membershipIds: [A.members.emp.membership.id] })).status).toBe(409);
    expect((await as(owner).post('/projects').send({ name: 'New', branchId: bole.id })).status).toBe(422);
    expect((await as(owner).patch(`/branches/${bole.id}`).send({ status: 'ACTIVE' })).body.data.status).toBe('ACTIVE');
  });
});

describe('subscription limits are company-wide', () => {
  it('the plan limits active branches (default included); archiving frees a slot; branches never bypass user/project limits', async () => {
    await usePlan(A.org.id, 'FREE'); // 1 branch, 3 users, 3 projects
    const blocked = await as(owner).post('/branches').send({ name: 'Bole Branch' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_BRANCH_LIMIT');

    await usePlan(A.org.id, 'PROFESSIONAL'); // 5 branches
    const b = await createBranch(owner, { name: 'Bole Branch' });
    for (let i = 0; i < 3; i++) await createBranch(owner, { name: `Branch ${i}` });
    expect((await as(owner).post('/branches').send({ name: 'Sixth' })).status).toBe(402);
    await as(owner).patch(`/branches/${b.id}`).send({ status: 'INACTIVE' });
    expect((await as(owner).post('/branches').send({ name: 'Sixth' })).status).toBe(201);
    // Reactivating would exceed the limit.
    expect((await as(owner).patch(`/branches/${b.id}`).send({ status: 'ACTIVE' })).status).toBe(402);

    // Projects across branches count together against the company limit.
    await usePlan(A.org.id, 'FREE');
    const free = await prisma.branch.findFirst({ where: { organizationId: A.org.id, isDefault: true } });
    for (let i = 0; i < 3; i++) await createProject(owner, { name: `P${i}`, branchId: i ? free.id : undefined });
    expect((await as(owner).post('/projects').send({ name: 'P4', branchId: free.id })).status).toBe(402);
  });

  it('a downgrade below the number of active branches is refused', async () => {
    await usePlan(A.org.id, 'BUSINESS');
    await createBranch(owner, { name: 'Bole Branch' });
    const res = await as(owner).post('/payments/checkout').send({ planId: plans.FREE.id });
    expect(res.status).toBeGreaterThanOrEqual(400); // Free needs no payment; the plan-fit check is covered below
    const pro = await prisma.subscriptionPlan.update({ where: { code: 'PROFESSIONAL' }, data: { maxBranches: 1 } });
    const checkout = await as(owner).post('/payments/checkout').send({ planId: pro.id });
    expect(checkout.status).toBe(409);
    expect(checkout.body.error.message).toMatch(/2 active branches/);
  });
});

describe('profile exposes the caller\'s own branches', () => {
  it('/auth/me lists active branches the person works in or manages, never others', async () => {
    const bole = await createBranch(owner, { name: 'Bole Branch', managerId: A.members.manager.membership.id });
    await createBranch(owner, { name: 'CMC Branch' });
    const me = (await as(manager).get('/auth/me')).body.data.workspace;
    expect(me.myBranches).toEqual([{ id: bole.id, name: 'Bole Branch', isDefault: false, isManager: true }]);
    expect(me.usage.branches).toBe(3);
  });
});
