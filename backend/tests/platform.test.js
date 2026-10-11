import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import {
  app, as, createPlatformAdmin, createProject, createTask, createTenant, lastPlatformCode, login, PASSWORD, platform, platformLogin,
  PLATFORM_PASSWORD, prisma, resetDb, testOutbox,
} from './helpers.js';

let A, owner, admin, agent;
const H = { 'X-TeamFlow-Client': 'test' };

const cli = (args, env = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/platform-admin.js', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

beforeEach(async () => {
  await resetDb();
  A = await createTenant({ name: 'Abay Trading PLC', members: [{ key: 'emp', role: 'EMPLOYEE' }] });
  owner = await login(A.owner.user.email);
  admin = await createPlatformAdmin({ email: 'operator@example.com' });
  agent = await platformLogin(admin.email);
});

describe('platform sign-in: separate identity, two factors, own session', () => {
  it('needs the password and then the emailed code; the code is single use', async () => {
    const a = request.agent(app);
    const wrong = await a.post('/api/v1/platform/auth/login').set(H).send({ email: admin.email, password: 'nope-nope-1' });
    expect(wrong.status).toBe(401);

    const start = await a.post('/api/v1/platform/auth/login').set(H).send({ email: admin.email, password: PLATFORM_PASSWORD });
    expect(start.status).toBe(200);
    expect(start.body.data.sentTo).toBe('o•••@example.com');
    const code = lastPlatformCode(admin.email);
    expect(JSON.stringify(start.body)).not.toContain(code); // the code only travels by email
    expect(await prisma.platformLoginChallenge.count({ where: { codeHash: code } })).toBe(0); // stored hashed

    // No session before the second factor.
    expect((await a.get('/api/v1/platform/overview')).status).toBe(401);
    const bad = await a.post('/api/v1/platform/auth/verify').set(H).send({ challengeId: start.body.data.challengeId, code: code === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(401);

    const ok = await a.post('/api/v1/platform/auth/verify').set(H).send({ challengeId: start.body.data.challengeId, code });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/tf_platform=.*Path=\/api\/v1\/platform.*HttpOnly.*SameSite=Strict/i);
    expect((await a.get('/api/v1/platform/overview')).status).toBe(200);

    const replay = await request(app).post('/api/v1/platform/auth/verify').set(H).send({ challengeId: start.body.data.challengeId, code });
    expect(replay.status).toBe(401);
  });

  it('locks the challenge after 5 wrong codes', async () => {
    const start = await request(app).post('/api/v1/platform/auth/login').set(H).send({ email: admin.email, password: PLATFORM_PASSWORD });
    const code = lastPlatformCode(admin.email);
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/platform/auth/verify').set(H).send({ challengeId: start.body.data.challengeId, code: wrong });
    const late = await request(app).post('/api/v1/platform/auth/verify').set(H).send({ challengeId: start.body.data.challengeId, code });
    expect(late.status).toBe(401);
  });

  it('platform sessions expire when idle and end on sign-out', async () => {
    await prisma.platformSession.updateMany({ data: { lastUsedAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await platform(agent).get('/platform/overview')).status).toBe(401);

    const again = await platformLogin(admin.email);
    expect((await platform(again).post('/platform/auth/logout')).status).toBe(200);
    expect((await platform(again).get('/platform/overview')).status).toBe(401);
  });

  it('a disabled platform admin cannot sign in, and is signed out', async () => {
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    expect((await platform(agent).get('/platform/overview')).status).toBe(401);
    const res = await request(app).post('/api/v1/platform/auth/login').set(H).send({ email: admin.email, password: PLATFORM_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('writes without the client header are refused (CSRF protection)', async () => {
    const res = await agent.patch(`/api/v1/platform/organizations/${A.org.id}/status`).send({ status: 'SUSPENDED', reason: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_PROTECTION');
  });
});

describe('separate authorization boundaries', () => {
  it('an organization owner cannot use any platform API, with or without their token', async () => {
    for (const path of ['/platform/overview', '/platform/organizations', `/platform/organizations/${A.org.id}`, '/platform/payments', '/platform/audit-logs', '/platform/health', '/platform/subscriptions']) {
      expect((await as(owner).get(path)).status, path).toBe(401);
    }
    expect((await as(owner).patch(`/platform/organizations/${A.org.id}/status`).set(H).send({ status: 'SUSPENDED', reason: 'x' })).status).toBe(401);
  });

  it('tenant credentials cannot sign in to the platform, and nobody gains platform access through tenant APIs', async () => {
    const res = await request(app).post('/api/v1/platform/auth/login').set(H).send({ email: A.owner.user.email, password: PASSWORD });
    expect(res.status).toBe(401);
    const reg = await request(app).post('/api/v1/auth/register').send({ firstName: 'E', lastName: 'Vil', email: 'evil@example.com', password: PASSWORD, isPlatformAdmin: true });
    expect(reg.status).toBe(422);
    const profile = await as(owner).patch('/auth/me').send({ firstName: 'O', lastName: 'W', isPlatformAdmin: true });
    expect(profile.status).toBe(422);
    expect(await prisma.platformAdmin.count()).toBe(1);
  });

  it('a platform session gives no access to tenant APIs, even with guessed ids', async () => {
    const project = await createProject(owner, { name: 'Confidential Tender' });
    const task = await createTask(owner, project.id, { title: 'Secret pricing sheet' });
    for (const path of ['/projects', `/projects/${project.id}`, `/tasks/${task.id}`, '/tasks', '/activities', '/dashboard', '/users', '/branches', '/auth/me']) {
      expect((await platform(agent).get(path)).status, path).toBe(401);
    }
  });
});

describe('privacy: allowlisted company metadata only', () => {
  it('lists and shows companies without any project or task data', async () => {
    const project = await createProject(owner, { name: 'Confidential Tender', description: 'Bid for the airport' });
    await createTask(owner, project.id, { title: 'Secret pricing sheet' });

    const list = await platform(agent).get('/platform/organizations?search=abay');
    expect(list.status).toBe(200);
    const [org] = list.body.data;
    expect(Object.keys(org).sort()).toEqual(['activeBranches', 'activeMembers', 'closureRequestedAt', 'createdAt', 'currentPeriodEnd', 'id', 'name', 'plan', 'status', 'subscriptionStatus']);
    expect(org).toMatchObject({ name: 'Abay Trading PLC', activeMembers: 2, activeBranches: 1, plan: { code: 'FREE' } });

    const detail = await platform(agent).get(`/platform/organizations/${A.org.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.billingContacts).toEqual([{ name: 'Owner User', email: A.owner.user.email }]);
    expect(detail.body.data.subscription.limits).toEqual({ maxUsers: 3, maxProjects: 3, maxBranches: 1 });
    const text = JSON.stringify([list.body, detail.body, (await platform(agent).get('/platform/overview')).body]);
    for (const secret of ['Confidential Tender', 'airport', 'Secret pricing sheet', 'passwordHash', 'tokenHash', 'projects', 'tasks']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('subscriptions, payments, health and audit views work', async () => {
    expect((await platform(agent).get('/platform/subscriptions')).body.data[0]).toMatchObject({ organization: { name: 'Abay Trading PLC' }, plan: { code: 'FREE' } });
    expect((await platform(agent).get('/platform/payments?status=FAILED')).status).toBe(200);
    const health = await platform(agent).get('/platform/health');
    expect(health.body.data).toMatchObject({ database: { ok: true }, payments: { mode: 'TEST', webhookSecretConfigured: true } });
    expect((await platform(agent).get('/platform/audit-logs')).body.data[0].action).toBe('PLATFORM_SIGNED_IN');
  });
});

describe('suspension and reactivation', () => {
  it('suspending needs a reason, blocks the workspace, keeps the data, and is audited; reactivation restores access', async () => {
    const project = await createProject(owner, { name: 'Kept Project' });
    expect((await platform(agent).patch(`/platform/organizations/${A.org.id}/status`).send({ status: 'SUSPENDED' })).status).toBe(422);

    const res = await platform(agent).patch(`/platform/organizations/${A.org.id}/status`).send({ status: 'SUSPENDED', reason: 'Unpaid invoices' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');
    const blocked = await as(owner).get('/projects');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    expect((await as(owner).post('/projects').send({ name: 'New' })).status).toBe(403);
    expect(await prisma.project.count({ where: { organizationId: A.org.id } })).toBe(1); // data preserved

    const [entry] = (await platform(agent).get(`/platform/audit-logs?organizationId=${A.org.id}`)).body.data;
    expect(entry).toMatchObject({ action: 'ORGANIZATION_SUSPENDED', targetId: A.org.id, metadata: { reason: 'Unpaid invoices' }, actor: { email: admin.email } });
    expect(entry.ipAddress).toBeTruthy();

    await platform(agent).patch(`/platform/organizations/${A.org.id}/status`).send({ status: 'ACTIVE' });
    expect((await as(owner).get(`/projects/${project.id}`)).status).toBe(200);
  });

  it('plan changes record old and new values, including the branch limit', async () => {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
    await platform(agent).patch(`/platform/plans/${plan.id}`).send({ maxBranches: 8 });
    const [entry] = (await platform(agent).get('/platform/audit-logs?action=PLAN_UPDATED')).body.data;
    expect(entry.metadata.changes.maxBranches).toEqual({ from: 5, to: 8 });
  });
});

describe('provisioning (command line only)', () => {
  it('creates admins only with a strong password from the environment, and audits every change', async () => {
    expect(cli(['create', 'new@example.com', 'New', 'Admin'], { PLATFORM_ADMIN_PASSWORD: 'short' }).code).not.toBe(0);
    const made = cli(['create', 'new@example.com', 'New', 'Admin'], { PLATFORM_ADMIN_PASSWORD: 'A-strong-pass-2026' });
    expect(made.code, made.out).toBe(0);
    expect(made.out).not.toContain('A-strong-pass-2026');
    expect(await prisma.platformAuditLog.count({ where: { action: 'PLATFORM_ADMIN_CREATED' } })).toBe(1);

    // Disabling signs the admin out at once; the last active admin cannot be disabled.
    expect(cli(['disable', admin.email]).code).toBe(0);
    expect((await platform(agent).get('/platform/overview')).status).toBe(401);
    expect(cli(['disable', 'new@example.com']).code).not.toBe(0);
    testOutbox.length = 0;
  });
});

describe('people of a suspended company', () => {
  it('signing in after the suspension tells them the company is suspended (and still blocks the workspace)', async () => {
    await platform(agent).patch(`/platform/organizations/${A.org.id}/status`).send({ status: 'SUSPENDED', reason: 'Unpaid invoices' });
    const token = await login(A.members.emp.user.email);
    const me = (await as(token).get('/auth/me')).body.data;
    expect(me.workspace).toBeNull();
    expect(me.workspaceBlockedReason).toBe('ORGANIZATION_SUSPENDED');
    expect((await as(token).get('/projects')).body.error.code).toBe('ORGANIZATION_SUSPENDED');
  });
});
