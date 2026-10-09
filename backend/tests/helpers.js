import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { testOutbox } from '../src/lib/mailer.js';
import { chapaFake } from './fakeChapa.js';
import { ensureReferenceData } from '../src/bootstrap.js';
import { DEFAULT_PLANS } from '../src/common/constants/plans.js';
import { hashPassword } from '../src/common/utils/crypto.js';
import { createOrganization } from '../src/modules/organizations/organization.service.js';

export const app = createApp();
export const PASSWORD = 'Passw0rd!';
export { prisma, testOutbox, chapaFake };

/** Empties all tenant data, keeping the permission catalog and plans. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "activity_logs","payments","subscriptions","tasks","project_members","projects","auth_tokens","sessions","memberships","role_permissions","roles","organizations","users" CASCADE',
  );
  await ensureReferenceData();
  for (const { code, ...plan } of DEFAULT_PLANS) await prisma.subscriptionPlan.update({ where: { code }, data: { ...plan, isActive: true } });
  testOutbox.length = 0;
  chapaFake.reset();
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createVerifiedUser({ firstName = 'Test', lastName = 'User', email } = {}) {
  return prisma.user.create({
    data: { firstName, lastName, email: email ?? `user-${uid()}@example.com`, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() },
  });
}

/**
 * Creates a tenant through the real organization service, then adds members with the
 * requested system roles. Returns { org, owner, members: { key: { user, membership } } }.
 */
export async function createTenant({ name = `Org ${uid()}`, members = [] } = {}) {
  const ownerUser = await createVerifiedUser({ firstName: 'Owner' });
  const { organization, membership } = await createOrganization(ownerUser.id, { name });
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { organizationId: organization.id } })).map((r) => [r.key, r]));

  const result = { org: organization, roles, owner: { user: ownerUser, membership }, members: {} };
  for (const { key, role, status = 'ACTIVE' } of members) {
    const user = await createVerifiedUser({ firstName: key });
    const m = await prisma.membership.create({
      data: { organizationId: organization.id, userId: user.id, roleId: roles[role].id, status, joinedAt: new Date() },
    });
    result.members[key] = { user, membership: m };
  }
  return result;
}

export async function login(email, password = PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

/** Authenticated request helper: as(token).get('/projects') */
export const as = (token) => {
  const wrap = (method) => (path) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), delete: wrap('delete') };
};

export const lastEmailToken = (to) => {
  const mail = [...testOutbox].reverse().find((m) => m.to === to);
  const match = mail?.text.match(/token=([^\s&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

export async function createProject(token, body = {}) {
  const res = await as(token).post('/projects').send({ name: `Project ${uid()}`, ...body });
  if (res.status !== 201) throw new Error(`createProject failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createTask(token, projectId, body = {}) {
  const res = await as(token).post('/tasks').send({ projectId, title: `Task ${uid()}`, ...body });
  if (res.status !== 201) throw new Error(`createTask failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}
