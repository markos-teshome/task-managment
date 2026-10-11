import { beforeEach, describe, expect, it } from 'vitest';
import { as, createProject, createTenant, login, prisma, resetDb } from './helpers.js';

let A, B, ownerA, ownerB, project, plans;
const DAY = 86_400_000;

/** Fast bulk data straight in the database (the API path is covered by the other suites). */
async function seedTasks(count, { dueDate = new Date('2026-12-01'), title = (i) => `Task ${String(i).padStart(3, '0')}`, createdAt } = {}) {
  await prisma.task.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      organizationId: A.org.id, projectId: project.id, title: title(i), dueDate, createdById: A.owner.membership.id, ...(createdAt && { createdAt }),
    })),
  });
}
const pageOf = (path) => as(ownerA).get(path).then((r) => r.body);
const ids = (body) => body.data.map((t) => t.id);

beforeEach(async () => {
  await resetDb();
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  A = await createTenant({ name: 'Paging A' });
  B = await createTenant({ name: 'Paging B' });
  await prisma.subscription.update({ where: { organizationId: A.org.id }, data: { planId: plans.BUSINESS.id, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
  ownerA = await login(A.owner.user.email);
  ownerB = await login(B.owner.user.email);
  project = await createProject(ownerA, { name: 'Bulk' });
});

describe('numbered pages', () => {
  it('equal sort values (same due date, same timestamp) never repeat or skip rows across pages', async () => {
    await seedTasks(45, { createdAt: new Date('2026-10-01T08:00:00Z') }); // identical dueDate AND createdAt
    const seen = [];
    for (const page of [1, 2, 3]) {
      const body = await pageOf(`/tasks?projectId=${project.id}&sort=dueDate&order=asc&pageSize=20&page=${page}`);
      expect(body.meta).toMatchObject({ page, pageSize: 20, total: 45, totalPages: 3, hasPreviousPage: page > 1, hasNextPage: page < 3 });
      seen.push(...ids(body));
    }
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
    // The same request twice returns the same order (deterministic).
    const again = await pageOf(`/tasks?projectId=${project.id}&sort=dueDate&order=asc&pageSize=20&page=2`);
    expect(ids(again)).toEqual(seen.slice(20, 40));
  });

  it('boundaries: 0, 1, exactly one page, one more than a page, and a page past the end', async () => {
    const meta = async () => (await pageOf(`/tasks?projectId=${project.id}&pageSize=20`)).meta;
    expect(await meta()).toMatchObject({ total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false });
    await seedTasks(1);
    expect(await meta()).toMatchObject({ total: 1, totalPages: 1 });
    await seedTasks(19);
    expect(await meta()).toMatchObject({ total: 20, totalPages: 1, hasNextPage: false });
    await seedTasks(1);
    expect(await meta()).toMatchObject({ total: 21, totalPages: 2, hasNextPage: true });
    const last = await pageOf(`/tasks?projectId=${project.id}&pageSize=20&page=2`);
    expect(last.data).toHaveLength(1);
    const beyond = await pageOf(`/tasks?projectId=${project.id}&pageSize=20&page=9`);
    expect(beyond.data).toEqual([]); // the UI moves back to totalPages
    expect(beyond.meta).toMatchObject({ page: 9, totalPages: 2, hasNextPage: false });
  });

  it('invalid page and page-size values are refused, and the 100-row cap cannot be bypassed', async () => {
    for (const q of ['page=0', 'page=-1', 'page=abc', 'page=10001', 'pageSize=0', 'pageSize=101', 'pageSize=100000', 'pageSize=2.5']) {
      const res = await as(ownerA).get(`/tasks?${q}`);
      expect(res.status, q).toBe(422);
    }
    for (const path of ['/projects', '/users', '/activities', '/notifications', '/payments']) {
      expect((await as(ownerA).get(`${path}?pageSize=500`)).status, path).toBe(422);
    }
  });

  it('search and filters run on the whole dataset before paging, and the total matches them', async () => {
    await seedTasks(30, { title: (i) => (i % 3 === 0 ? `Invoice ${i}` : `Other ${i}`) });
    const body = await pageOf(`/tasks?projectId=${project.id}&search=invoice&pageSize=4&page=3`);
    expect(body.meta).toMatchObject({ total: 10, totalPages: 3 });
    expect(body.data).toHaveLength(2);
    expect(body.data.every((t) => t.title.startsWith('Invoice'))).toBe(true);
    const none = await pageOf(`/tasks?projectId=${project.id}&search=nothing-like-this`);
    expect(none.meta).toMatchObject({ total: 0, totalPages: 1 });
  });
});

describe('tenant isolation', () => {
  it("another organization's pages, counts and searches show none of these rows", async () => {
    await seedTasks(25);
    for (const path of ['/tasks?pageSize=100', '/tasks?search=Task&pageSize=100', '/projects?pageSize=100', '/activities?pageSize=100', '/users?pageSize=100']) {
      const body = (await as(ownerB).get(path)).body;
      const leaked = JSON.stringify(body.data).includes('Bulk') || JSON.stringify(body.data).includes(A.org.id);
      expect(leaked, path).toBe(false);
    }
    expect((await as(ownerB).get('/tasks')).body.meta.total).toBe(0);
    expect((await as(ownerB).get(`/tasks?projectId=${project.id}`)).body.meta.total).toBe(0); // someone else's project id
  });
});

describe('activity timeline (cursor)', () => {
  const feed = (cursor) => pageOf(`/activities?pageSize=5${cursor ? `&cursor=${cursor}` : ''}`);
  async function addActivity(n, at) {
    await prisma.activityLog.createMany({
      data: Array.from({ length: n }, (_, i) => ({ organizationId: A.org.id, action: 'PROJECT_UPDATED', entityType: 'PROJECT', metadata: { name: `E${i}` }, createdAt: at })),
    });
  }

  it('"Load more" continues after the last entry even while new entries arrive, without repeats or gaps', async () => {
    await prisma.activityLog.deleteMany({ where: { organizationId: A.org.id } });
    await addActivity(12, new Date('2026-10-01T08:00:00Z')); // identical timestamps on purpose
    const first = await feed();
    expect(first.data).toHaveLength(5);
    await addActivity(3, new Date()); // newer entries appear at the top meanwhile
    const second = await feed(first.meta.nextCursor);
    const third = await feed(second.meta.nextCursor);
    const all = [...first.data, ...second.data, ...third.data].map((a) => a.id);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
    expect(third.meta.nextCursor).toBeNull();
  });

  it("a cursor from another organization is refused (it can't be used to probe)", async () => {
    const theirs = await prisma.activityLog.findFirst({ where: { organizationId: A.org.id } });
    const res = await as(ownerB).get(`/activities?cursor=${theirs.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('team list', () => {
  it('people with the same first name page deterministically', async () => {
    const users = await Promise.all(
      Array.from({ length: 23 }, (_, i) => prisma.user.create({ data: { email: `same-${i}@example.com`, firstName: 'Abebe', lastName: 'Same', passwordHash: 'x', emailVerifiedAt: new Date() } })),
    );
    await prisma.membership.createMany({ data: users.map((u) => ({ organizationId: A.org.id, userId: u.id, roleId: A.roles.EMPLOYEE.id, status: 'ACTIVE', joinedAt: new Date() })) });
    const seen = [];
    for (const page of [1, 2, 3]) seen.push(...ids(await pageOf(`/users?pageSize=10&page=${page}`)));
    expect(seen).toHaveLength(24); // 23 + the owner
    expect(new Set(seen).size).toBe(24);
  });
});
