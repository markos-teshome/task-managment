import { beforeEach, describe, expect, it } from 'vitest';
import { as, createProject, createTenant, createVerifiedUser, login, prisma, resetDb } from './helpers.js';

let A, owner;

beforeEach(async () => {
  await resetDb();
  A = await createTenant({ name: 'Abay Trading PLC' });
  owner = await login(A.owner.user.email);
});

describe('creating an organization', () => {
  it('an existing owner can create a second organization: Owner role, default roles, Free plan, clean workspace', async () => {
    await createProject(owner, { name: 'Website Development' });

    const res = await as(owner).post('/organizations').send({ name: '  My   New Organization ' });
    expect(res.status).toBe(201);
    const { me } = res.body.data;
    expect(me.workspace.organization.name).toBe('My New Organization'); // whitespace normalised
    expect(me.workspace.role.key).toBe('OWNER');
    expect(me.workspace.plan.code).toBe('FREE');
    expect(me.memberships.map((m) => m.organization.name).sort()).toEqual(['Abay Trading PLC', 'My New Organization']);

    const token = res.body.data.accessToken;
    expect((await as(token).get('/projects')).body.data).toEqual([]);
    expect((await as(token).get('/roles')).body.data.map((r) => r.key).sort()).toEqual(['ADMIN', 'EMPLOYEE', 'MANAGER', 'OWNER']);
  });

  it("refuses a name the person already uses, but another company may use the same name (no tenant enumeration)", async () => {
    const dup = await as(owner).post('/organizations').send({ name: 'abay trading plc' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ORGANIZATION_NAME_IN_USE');

    const stranger = await createVerifiedUser();
    const res = await as(await login(stranger.email)).post('/organizations').send({ name: 'Abay Trading PLC' });
    expect(res.status).toBe(201);
    const slugs = (await prisma.organization.findMany({ where: { name: 'Abay Trading PLC' } })).map((o) => o.slug);
    expect(new Set(slugs).size).toBe(2);
  });

  it('validates the name', async () => {
    for (const name of ['', ' a ', '---', '<b>Acme</b>', 'x'.repeat(81)]) {
      const res = await as(owner).post('/organizations').send({ name });
      expect(res.status, name).toBe(422);
    }
  });

  it('cannot attach the caller to an existing organization or choose a role', async () => {
    const res = await as(owner).post('/organizations').send({ name: 'Anything', organizationId: A.org.id, roleId: A.roles.OWNER.id });
    expect(res.status).toBe(422);
  });

  it('an unverified user cannot create an organization', async () => {
    const user = await createVerifiedUser();
    const token = await login(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    const res = await as(token).post('/organizations').send({ name: 'Ghost Co' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('switching between organizations', () => {
  it('every tenant-scoped view follows the active organization', async () => {
    await createProject(owner, { name: 'Abay Only Project' });
    const second = await as(owner).post('/organizations').send({ name: 'Second Org' });
    const token = second.body.data.accessToken;

    // Active = Second Org: nothing from Abay is visible.
    expect((await as(token).get('/projects')).body.data).toEqual([]);
    expect((await as(token).get('/dashboard')).body.data.stats.totalProjects).toBe(0);
    const activity = (await as(token).get('/activities')).body.data;
    expect(activity.every((a) => !JSON.stringify(a).includes('Abay Only Project'))).toBe(true);
    expect((await as(token).get('/payments')).status).toBe(200);

    // Switch back.
    const abay = second.body.data.me.memberships.find((m) => m.organization.name === 'Abay Trading PLC');
    const back = await as(token).post('/auth/switch-workspace').send({ membershipId: abay.id });
    expect(back.status).toBe(200);
    expect(back.body.data.me.workspace.organization.name).toBe('Abay Trading PLC');
    expect((await as(token).get('/projects')).body.data.map((p) => p.name)).toEqual(['Abay Only Project']);
  });

  it('a tab still showing the previous organization gets 409 instead of the other organization\'s data', async () => {
    const abayMembership = A.owner.membership.id;
    const ok = await as(owner).get('/projects').set('X-Workspace-Id', abayMembership);
    expect(ok.status).toBe(200);

    await as(owner).post('/organizations').send({ name: 'Second Org' }); // switches the session

    const stale = await as(owner).get('/projects').set('X-Workspace-Id', abayMembership);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('WORKSPACE_CHANGED');
  });

  it("cannot switch into an organization through someone else's membership", async () => {
    const B = await createTenant({ name: 'Gift Construction PLC' });
    const res = await as(owner).post('/auth/switch-workspace').send({ membershipId: B.owner.membership.id });
    expect(res.status).toBe(404);
  });
});

describe('one person, several organizations', () => {
  it('the same account owns two companies, each with its own subscription, default branch and data; nothing is duplicated', async () => {
    const second = await as(owner).post('/organizations').send({ name: 'Gift Construction PLC' });
    expect(second.status).toBe(201);
    expect(await prisma.user.count({ where: { email: A.owner.user.email } })).toBe(1);

    const orgs = await prisma.organization.findMany({ where: { memberships: { some: { userId: A.owner.user.id } } }, include: { subscription: true, branches: true } });
    expect(orgs).toHaveLength(2);
    expect(new Set(orgs.map((o) => o.subscription.id)).size).toBe(2);
    expect(orgs.every((o) => o.branches.length === 1 && o.branches[0].isDefault && o.branches[0].name === 'Head Office')).toBe(true);
    const created = await prisma.activityLog.findFirst({ where: { organizationId: second.body.data.me.workspace.organization.id, action: 'ORGANIZATION_CREATED' } });
    expect(created).not.toBeNull();
  });

  it('GET /me/organizations lists only the caller\'s organizations and marks the active one', async () => {
    const B = await createTenant({ name: 'Unrelated Co' }); // someone else's company
    const second = await as(owner).post('/organizations').send({ name: 'Second Org' });
    const token = second.body.data.accessToken;

    const res = await as(token).get('/me/organizations');
    expect(res.status).toBe(200);
    expect(res.body.data.organizations.map((o) => o.organization.name).sort()).toEqual(['Abay Trading PLC', 'Second Org']);
    expect(res.body.data.organizations.find((o) => o.isActive).organization.name).toBe('Second Org');
    expect(res.body.data.activeOrganizationId).toBe(second.body.data.me.workspace.organization.id);
    expect(JSON.stringify(res.body)).not.toContain(B.org.id);
  });

  it('POST /organizations/switch changes the security context; another tenant\'s organization id is refused', async () => {
    const B = await createTenant({ name: 'Unrelated Co' });
    await as(owner).post('/organizations').send({ name: 'Second Org' });

    const refused = await as(owner).post('/organizations/switch').send({ organizationId: B.org.id });
    expect(refused.status).toBe(404);

    const res = await as(owner).post('/organizations/switch').send({ organizationId: A.org.id });
    expect(res.status).toBe(200);
    expect(res.body.data.me.workspace.organization.name).toBe('Abay Trading PLC');
    expect(res.body.data.me.workspace.role.key).toBe('OWNER');
  });

  it('a person can be Owner in one company and Employee in another, with different permissions', async () => {
    const B = await createTenant({ name: 'Gift Construction PLC' });
    await prisma.membership.create({ data: { organizationId: B.org.id, userId: A.owner.user.id, roleId: B.roles.EMPLOYEE.id, status: 'ACTIVE', joinedAt: new Date() } });
    const res = await as(owner).post('/organizations/switch').send({ organizationId: B.org.id });
    const token = res.body.data.accessToken;
    expect(res.body.data.me.workspace.role.key).toBe('EMPLOYEE');
    expect((await as(token).get('/billing')).status).toBe(404); // no such route either way
    expect((await as(token).get('/payments')).status).toBe(403); // employee: no billing in this company
    expect((await as(token).post('/projects').send({ name: 'x' })).status).toBe(403);
  });
});

describe('several owners, never zero', () => {
  let T, first, second;
  beforeEach(async () => {
    T = await createTenant({ name: 'Owners Co', members: [{ key: 'second', role: 'OWNER' }] });
    first = await login(T.owner.user.email);
    second = await login(T.members.second.user.email);
  });

  it('an organization can have several owners, and one owner may remove another while one remains', async () => {
    expect(await prisma.membership.count({ where: { organizationId: T.org.id, status: 'ACTIVE', role: { key: 'OWNER' } } })).toBe(2);
    expect((await as(first).delete(`/users/${T.members.second.membership.id}`)).status).toBe(200);
    expect(await prisma.membership.count({ where: { organizationId: T.org.id, status: 'ACTIVE', role: { key: 'OWNER' } } })).toBe(1);
  });

  it('the final owner can neither leave nor be demoted by themselves', async () => {
    await as(first).delete(`/users/${T.members.second.membership.id}`);
    expect((await as(first).delete(`/users/${T.owner.membership.id}`)).status).toBe(403);
    expect((await as(first).patch(`/users/${T.owner.membership.id}`).send({ roleId: T.roles.ADMIN.id })).status).toBe(403);
  });

  it('two owners removing each other at the same moment never leave the organization without an owner', async () => {
    const results = await Promise.all([
      as(first).delete(`/users/${T.members.second.membership.id}`),
      as(second).delete(`/users/${T.owner.membership.id}`),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: T.org.id, status: 'ACTIVE', role: { key: 'OWNER' } } })).toBe(1);
  });
});
