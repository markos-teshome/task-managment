import { beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { app, as, chapaFake, createTenant, login, prisma, resetDb } from './helpers.js';
import { CHECKOUT_TTL_MS, processPayment } from '../src/modules/payments/payment.service.js';

let T, owner, plans;

const checkout = async (code = 'PROFESSIONAL') => {
  const res = await as(owner).post('/payments/checkout').send({ planId: plans[code].id });
  expect(res.status).toBe(201);
  return res.body.data.txRef;
};
const verify = (txRef) => as(owner).post(`/payments/${txRef}/verify`);
const planCode = async () => (await as(owner).get('/subscription')).body.data.plan.code;
const ageCheckout = (txRef) =>
  prisma.payment.update({ where: { txRef }, data: { createdAt: new Date(Date.now() - CHECKOUT_TTL_MS - 60_000) } });
const webhook = (txRef) => {
  const body = JSON.stringify({ event: 'charge.success', tx_ref: txRef, status: 'success' });
  const signature = crypto.createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET).update(body).digest('hex');
  return request(app).post('/api/v1/payments/webhooks/chapa').set('Content-Type', 'application/json').set('x-chapa-signature', signature).send(body);
};

beforeEach(async () => {
  await resetDb();
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  T = await createTenant();
  owner = await login(T.owner.user.email);
});

describe('outcomes reported by Chapa', () => {
  it('a payment cancelled at Chapa becomes CANCELLED and changes nothing', async () => {
    const txRef = await checkout();
    chapaFake.settle(txRef, 'cancelled');
    const res = await verify(txRef);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.checkoutUrl).toBeNull();
    expect(await planCode()).toBe('FREE');
  });

  it('a customer-cancelled checkout stays cancelled while Chapa reports no payment', async () => {
    const txRef = await checkout();
    expect((await as(owner).post(`/payments/${txRef}/cancel`)).body.data.status).toBe('CANCELLED');
    expect((await verify(txRef)).body.data.status).toBe('CANCELLED');
    expect(await planCode()).toBe('FREE');
  });
});

describe('expiry and late confirmation', () => {
  it('an abandoned checkout expires instead of staying pending forever', async () => {
    const txRef = await checkout();
    await ageCheckout(txRef);

    const viaVerify = await verify(txRef);
    expect(viaVerify.body.data.status).toBe('EXPIRED');
    expect(viaVerify.body.data.checkoutUrl).toBeNull();
    expect(await planCode()).toBe('FREE');
  });

  it('listing payments also expires stale checkouts (e.g. after the browser was closed)', async () => {
    const txRef = await checkout();
    await ageCheckout(txRef);
    const list = await as(owner).get('/payments');
    expect(list.body.data.find((p) => p.txRef === txRef).status).toBe('EXPIRED');
    expect((await as(owner).get(`/payments/${txRef}`)).body.data.status).toBe('EXPIRED');
  });

  it('a success that arrives after expiry is still honoured — money taken is never ignored', async () => {
    const txRef = await checkout();
    await ageCheckout(txRef);
    expect((await verify(txRef)).body.data.status).toBe('EXPIRED');

    chapaFake.settle(txRef, 'success');
    const late = await webhook(txRef);
    expect(late.status).toBe(200);
    expect((await as(owner).get(`/payments/${txRef}`)).body.data.status).toBe('SUCCEEDED');
    expect(await planCode()).toBe('PROFESSIONAL');
  });

  it('a superseded checkout that the customer paid anyway activates the plan when Chapa confirms it', async () => {
    const first = await checkout();
    const second = await checkout(); // the first becomes CANCELLED (superseded)
    expect((await as(owner).get(`/payments/${first}`)).body.data.status).toBe('CANCELLED');

    chapaFake.settle(first, 'success');
    expect((await webhook(first)).status).toBe(200);
    expect((await as(owner).get(`/payments/${first}`)).body.data.status).toBe('SUCCEEDED');
    expect((await as(owner).get(`/payments/${second}`)).body.data.status).toBe('PENDING');
    expect(await planCode()).toBe('PROFESSIONAL');
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'PAYMENT_COMPLETED' } })).toBe(1);
  });
});

describe('provider outages never lose or invent a payment', () => {
  it('network failure while verifying: 503, the payment stays pending, a later check succeeds', async () => {
    const txRef = await checkout();
    chapaFake.settle(txRef, 'success');
    chapaFake.outage = 'network';

    const down = await verify(txRef);
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('PAYMENT_VERIFICATION_UNAVAILABLE');
    expect((await as(owner).get(`/payments/${txRef}`)).body.data.status).toBe('PENDING');
    expect(await planCode()).toBe('FREE');

    chapaFake.outage = null; // e.g. the user refreshes the processing page later
    expect((await verify(txRef)).body.data.status).toBe('SUCCEEDED');
    expect(await planCode()).toBe('PROFESSIONAL');
  });

  it('a Chapa server error is treated as "unknown", never as a failed payment', async () => {
    const txRef = await checkout();
    chapaFake.settle(txRef, 'failed');
    chapaFake.outage = 'server';
    expect((await verify(txRef)).status).toBe(503);
    expect((await prisma.payment.findUnique({ where: { txRef } })).status).toBe('PENDING');
  });

  it('a webhook during an outage answers 5xx so Chapa retries it', async () => {
    const txRef = await checkout();
    chapaFake.settle(txRef, 'success');
    chapaFake.outage = 'network';
    expect((await webhook(txRef)).status).toBe(503);
    chapaFake.outage = null;
    expect((await webhook(txRef)).status).toBe(200);
    expect(await planCode()).toBe('PROFESSIONAL');
  });
});

describe('integrity', () => {
  it('state survives a restart: settlement only needs the stored row', async () => {
    const txRef = await checkout();
    chapaFake.settle(txRef, 'success');
    // A fresh call with nothing but the reference (no in-memory state) settles it.
    const settled = await processPayment(txRef);
    expect(settled.status).toBe('SUCCEEDED');
  });

  it('transaction references are unique in the database', async () => {
    const txRef = await checkout();
    const existing = await prisma.payment.findUnique({ where: { txRef } });
    const { id: _id, createdAt: _c, updatedAt: _u, providerData: _p, ...copy } = existing;
    await expect(prisma.payment.create({ data: copy })).rejects.toMatchObject({ code: 'P2002' });
  });

  it("another organization cannot read, verify or cancel this organization's payment by its reference", async () => {
    const txRef = await checkout();
    const B = await createTenant();
    const other = await login(B.owner.user.email);
    expect((await as(other).get(`/payments/${txRef}`)).status).toBe(404);
    expect((await as(other).post(`/payments/${txRef}/verify`)).status).toBe(404);
    expect((await as(other).post(`/payments/${txRef}/cancel`)).status).toBe(404);
    expect((await prisma.payment.findUnique({ where: { txRef } })).status).toBe('PENDING');
  });

  it('payment history can be filtered by the EXPIRED state', async () => {
    const txRef = await checkout();
    await ageCheckout(txRef);
    const res = await as(owner).get('/payments?status=EXPIRED');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.txRef)).toEqual([txRef]);
  });
});
