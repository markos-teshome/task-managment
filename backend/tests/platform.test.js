import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { app, as, createTenant, createVerifiedUser, login, PASSWORD, prisma, resetDb } from './helpers.js';

let A, owner, admin;

const cli = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/platform-admin.js', ...args], { env: process.env, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

beforeEach(async () => {
  await resetDb();
  A = await createTenant({ name: 'Abay Trading PLC' });
  owner = await login(A.owner.user.email);
  const adminUser = await createVerifiedUser({ firstName: 'Platform', email: 'operator@example.com' });
  await prisma.user.update({ where: { id: adminUser.id }, data: { isPlatformAdmin: true } });
  admin = await login(adminUser.email);
});

describe('platform administration is separate from organization ownership', () => {
  it('an organization owner has no platform access', async () => {
    for (const path of ['/platform/overview', '/platform/organizations', '/platform/payments', '/platform/audit-log']) {
      expect((await as(owner).get(path)).status, path).toBe(403);
    }
  });

  it('nobody becomes a platform admin by registering or editing their profile', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'E', lastName: 'Vil', email: 'evil@example.com', password: PASSWORD, isPlatformAdmin: true });
    expect(reg.status).toBe(422);
    const profile = await as(owner).patch('/auth/me').send({ firstName: 'O', lastName: 'W', isPlatformAdmin: true });
    expect(profile.status).toBe(422);
    expect((await prisma.user.findUnique({ where: { id: A.owner.user.id } })).isPlatformAdmin).toBe(false);
  });

  it("the platform admin manages tenants but cannot open a tenant's business data", async () => {
    expect((await as(admin).get('/platform/organizations')).body.data.map((o) => o.name)).toContain('Abay Trading PLC');
    expect((await as(admin).get('/projects')).status).toBe(403); // no membership → no tenant data
  });
});

describe('platform actions are audited', () => {
  it('suspending an organization is recorded with the acting admin, and blocks its members', async () => {
    const res = await as(admin).patch(`/platform/organizations/${A.org.id}`).send({ status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect((await as(owner).get('/projects')).body.error.code).toBe('ORGANIZATION_SUSPENDED');

    const log = (await as(admin).get('/platform/audit-log')).body.data;
    expect(log[0]).toMatchObject({ action: 'ORGANIZATION_SUSPENDED', targetId: A.org.id, actor: { email: 'operator@example.com' } });
  });

  it('plan changes record old and new values', async () => {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    await as(admin).patch(`/platform/plans/${plan.id}`).send({ maxUsers: 20 });
    const [entry] = (await as(admin).get('/platform/audit-log')).body.data;
    expect(entry.action).toBe('PLAN_UPDATED');
    expect(entry.metadata.changes.maxUsers).toEqual({ from: plan.maxUsers, to: 20 });
  });
});

describe('provisioning (command line only)', () => {
  it('grants only to an existing, verified account and records it', async () => {
    expect(cli('grant', 'nobody@example.com').code).not.toBe(0);

    const unverified = await prisma.user.create({ data: { email: 'pending@example.com', firstName: 'P', lastName: 'Q' } });
    expect(cli('grant', unverified.email).code).not.toBe(0);
    expect((await prisma.user.findUnique({ where: { id: unverified.id } })).isPlatformAdmin).toBe(false);

    const result = cli('grant', A.owner.user.email);
    expect(result.code).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: A.owner.user.id } })).isPlatformAdmin).toBe(true);
    expect(await prisma.platformAuditLog.count({ where: { action: 'PLATFORM_ADMIN_GRANTED', targetId: A.owner.user.id } })).toBe(1);

    // Rights are re-read on every request: revoking applies immediately.
    expect((await as(owner).get('/platform/overview')).status).toBe(200);
    expect(cli('revoke', A.owner.user.email).code).toBe(0);
    expect((await as(owner).get('/platform/overview')).status).toBe(403);
  });
});
