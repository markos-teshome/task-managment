import { beforeEach, describe, expect, it } from 'vitest';
import { as, chapaFake, createProject, createTenant, login, prisma, resetDb } from './helpers.js';
import { processPayment } from '../src/modules/payments/payment.service.js';

let T, owner, plans;

const invite = (email) =>
  as(owner).post('/users').send({ email, firstName: 'New', lastName: 'Member', roleId: T.roles.EMPLOYEE.id });

/** Checkout → the customer pays (or not) at Chapa → TeamFlow verifies with Chapa's API. */
async function upgradeTo(code, outcome = 'success') {
  const checkout = await as(owner).post('/payments/checkout').send({ planId: plans[code].id });
  expect(checkout.status).toBe(201);
  const { txRef } = checkout.body.data;
  chapaFake.settle(txRef, outcome);
  const done = await as(owner).post(`/payments/${txRef}/verify`);
  return { txRef, payment: done.body.data };
}

beforeEach(async () => {
  await resetDb();
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  // Free plan: 3 users. Owner + 2 members = full.
  T = await createTenant({ members: [{ key: 'a', role: 'MANAGER' }, { key: 'b', role: 'EMPLOYEE' }] });
  owner = await login(T.owner.user.email);
});

describe('subscription limits are enforced', () => {
  it('rejects a 4th member on the Free plan with a clear business error', async () => {
    const res = await invite('fourth@example.com');
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('SUBSCRIPTION_USER_LIMIT');
    expect(res.body.error.message).toMatch(/reached its user limit/);
    expect(await prisma.membership.count({ where: { organizationId: T.org.id } })).toBe(3);
  });

  it('counts pending invitations as used seats', async () => {
    await as(owner).patch(`/users/${T.members.b.membership.id}`).send({ status: 'DEACTIVATED' });
    expect((await invite('one@example.com')).status).toBe(201); // seat freed by deactivation
    expect((await invite('two@example.com')).status).toBe(402); // pending invite holds the seat
  });

  it('enforces the project limit and frees a slot when a project is archived', async () => {
    const p = [];
    for (let i = 0; i < 3; i++) p.push(await createProject(owner));
    const fourth = await as(owner).post('/projects').send({ name: 'Fourth' });
    expect(fourth.status).toBe(402);
    expect(fourth.body.error.code).toBe('SUBSCRIPTION_PROJECT_LIMIT');

    await as(owner).post(`/projects/${p[0].id}/archive`);
    expect((await as(owner).post('/projects').send({ name: 'Fourth' })).status).toBe(201);
    // Restoring would exceed the limit again.
    expect((await as(owner).post(`/projects/${p[0].id}/restore`)).status).toBe(402);
  });

  it('concurrent invitations cannot exceed the limit', async () => {
    await as(owner).patch(`/users/${T.members.b.membership.id}`).send({ status: 'DEACTIVATED' });
    const results = await Promise.all([invite('r1@example.com'), invite('r2@example.com'), invite('r3@example.com')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: T.org.id, status: { in: ['ACTIVE', 'INVITED'] } } })).toBe(3);
  });
});

describe('payments change what the organization can do', () => {
  it('upgrade succeeds and the new limit applies immediately', async () => {
    expect((await invite('blocked@example.com')).status).toBe(402);

    const { payment } = await upgradeTo('PROFESSIONAL');
    expect(payment.status).toBe('SUCCEEDED');

    expect((await invite('welcome@example.com')).status).toBe(201);
    const sub = await as(owner).get('/subscription');
    expect(sub.body.data.plan.code).toBe('PROFESSIONAL');
    expect(sub.body.data.subscription.currentPeriodEnd).not.toBeNull();

    const actions = (await prisma.activityLog.findMany({ where: { organizationId: T.org.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['PAYMENT_COMPLETED', 'SUBSCRIPTION_CHANGED']));
  });

  it('a duplicate payment confirmation has no additional effect', async () => {
    const { txRef } = await upgradeTo('PROFESSIONAL');
    const before = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });

    // Webhook retry, double-clicked verify and a racing callback all hit the same payment.
    await Promise.all([processPayment(txRef), processPayment(txRef), as(owner).post(`/payments/${txRef}/verify`)]);
    await as(owner).post(`/payments/${txRef}/verify`);

    const after = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });
    expect(after.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime());
    expect(await prisma.payment.count({ where: { organizationId: T.org.id, status: 'SUCCEEDED' } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'PAYMENT_COMPLETED' } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'SUBSCRIPTION_CHANGED' } })).toBe(1);
  });

  it('a failed payment changes nothing, and a failed payment cannot later be flipped to success', async () => {
    const { txRef, payment } = await upgradeTo('PROFESSIONAL', 'failed');
    expect(payment.status).toBe('FAILED');
    expect((await invite('still-blocked@example.com')).status).toBe(402);

    chapaFake.settle(txRef, 'success'); // even if the provider later claimed success
    const retry = await as(owner).post(`/payments/${txRef}/verify`);
    expect(retry.body.data.status).toBe('FAILED');
    expect((await as(owner).get('/subscription')).body.data.plan.code).toBe('FREE');
  });

  it('a pending payment does not activate anything until the provider confirms it', async () => {
    const checkout = await as(owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id });
    const verify = await as(owner).post(`/payments/${checkout.body.data.txRef}/verify`);
    expect(verify.body.data.status).toBe('PENDING');
    expect((await as(owner).get('/subscription')).body.data.plan.code).toBe('FREE');
  });

  it('checkout always goes through Chapa; the old mock gateway route is gone', async () => {
    const checkout = await as(owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id });
    expect(checkout.body.data.provider).toBe('CHAPA');
    expect(checkout.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.chapa\.co\//);
    const mock = await as(owner).post(`/payments/${checkout.body.data.txRef}/mock-complete`).send({ outcome: 'success' });
    expect(mock.status).toBe(404);
    expect((await as(owner).get('/subscription')).body.data.plan.code).toBe('FREE');
  });

  it('the client cannot choose the price', async () => {
    const res = await as(owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id, amountCents: 1 });
    expect(res.status).toBe(422);
  });

  it('renewing the same plan extends the current period', async () => {
    await upgradeTo('PROFESSIONAL');
    const first = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });
    await upgradeTo('PROFESSIONAL');
    const second = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });
    expect(second.currentPeriodEnd.getTime() - first.currentPeriodEnd.getTime()).toBe(30 * 86_400_000);
  });
});

describe('expiry and plan changes', () => {
  it('an expired subscription falls back to Free limits without deleting data', async () => {
    await upgradeTo('PROFESSIONAL');
    expect((await invite('fourth@example.com')).status).toBe(201);

    await prisma.subscription.update({ where: { organizationId: T.org.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });

    const sub = await as(owner).get('/subscription');
    expect(sub.body.data.plan.code).toBe('FREE');
    expect(sub.body.data.subscription.status).toBe('EXPIRED');
    expect((await invite('fifth@example.com')).status).toBe(402);
    expect(await prisma.membership.count({ where: { organizationId: T.org.id } })).toBe(4); // nothing removed
  });

  it('cancelling keeps the plan until the end of the paid period', async () => {
    await upgradeTo('PROFESSIONAL');
    const res = await as(owner).post('/subscription/cancel');
    expect(res.body.data.subscription.cancelAtPeriodEnd).toBe(true);
    expect(res.body.data.plan.code).toBe('PROFESSIONAL');
  });

  it('cannot switch to a plan smaller than current usage', async () => {
    await prisma.subscriptionPlan.update({ where: { code: 'PROFESSIONAL' }, data: { maxUsers: 2 } });
    const res = await as(owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_USAGE_EXCEEDS_LIMIT');
  });

  it('plan features gate functionality: CSV export is a Business feature', async () => {
    expect((await as(owner).get('/tasks/export')).status).toBe(402);
    await upgradeTo('PROFESSIONAL');
    expect((await as(owner).get('/tasks/export')).status).toBe(402);
    await upgradeTo('BUSINESS');
    const csv = await as(owner).get('/tasks/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
  });
});
