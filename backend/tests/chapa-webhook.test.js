import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, createTenant, prisma, resetDb } from './helpers.js';

/**
 * Chapa webhook + callback, end to end through the real routes. Chapa's HTTP API is stubbed:
 * every test controls what Chapa's verify endpoint answers, independent of what the webhook claims.
 */
const SECRET = process.env.CHAPA_WEBHOOK_SECRET;
const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('hex');

let T, plan, payment, verifyAnswer, fetchSpy;

const chapaVerifyResponse = (txRef, data) =>
  new Response(JSON.stringify({ message: 'Payment details', status: 'success', data: { tx_ref: txRef, reference: 'APqDvYw1okk2', ...data } }), { status: 200 });

const webhook = (body, headers = {}) =>
  request(app).post('/api/v1/payments/webhooks/chapa').set('Content-Type', 'application/json').set(headers).send(JSON.stringify(body));

const signed = (body) => webhook(body, { 'x-chapa-signature': hmac(JSON.stringify(body)) });
const currentPayment = () => prisma.payment.findUnique({ where: { id: payment.id } });
const currentPlan = async () => (await prisma.subscription.findUnique({ where: { organizationId: T.org.id }, include: { plan: true } })).plan.code;

beforeEach(async () => {
  await resetDb();
  T = await createTenant();
  plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PROFESSIONAL' } });
  payment = await prisma.payment.create({
    data: {
      organizationId: T.org.id,
      planId: plan.id,
      amountCents: plan.priceCents,
      currency: plan.currency,
      provider: 'CHAPA',
      txRef: `tf_chapa_${Date.now().toString(36)}`,
      initiatedById: T.owner.membership.id,
    },
  });
  verifyAnswer = { status: 'success', amount: (plan.priceCents / 100).toFixed(2), currency: plan.currency };
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => chapaVerifyResponse(payment.txRef, verifyAnswer));
});

afterEach(() => vi.restoreAllMocks());

const event = () => ({ event: 'charge.success', tx_ref: payment.txRef, status: 'success', amount: '1.00', currency: 'ETB' });

describe('Chapa webhook signature', () => {
  it('rejects a webhook without a valid signature and changes nothing', async () => {
    expect((await webhook(event())).status).toBe(401);
    expect((await webhook(event(), { 'x-chapa-signature': 'forged' })).status).toBe(401);
    expect((await webhook(event(), { 'chapa-signature': hmac('wrong-secret') })).status).toBe(401);
    expect((await currentPayment()).status).toBe('PENDING');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts x-chapa-signature = HMAC(secret, payload)', async () => {
    expect((await signed(event())).status).toBe(200);
    expect((await currentPayment()).status).toBe('SUCCEEDED');
  });

  it('accepts chapa-signature = HMAC(secret, secret) even when x-chapa-signature does not match', async () => {
    const res = await webhook(event(), { 'chapa-signature': hmac(SECRET), 'x-chapa-signature': 'stale' });
    expect(res.status).toBe(200);
    expect((await currentPayment()).status).toBe('SUCCEEDED');
  });
});

describe('Chapa webhook processing', () => {
  it("verifies with Chapa's API before activating the subscription", async () => {
    await signed(event());
    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`/transaction/verify/${payment.txRef}$`));
    expect(options.headers.Authorization).toBe(`Bearer ${process.env.CHAPA_SECRET_KEY}`);

    const settled = await currentPayment();
    expect(settled.providerReference).toBe('APqDvYw1okk2');
    expect(await currentPlan()).toBe('PROFESSIONAL');
  });

  it('trusts Chapa, not the webhook body: a "success" event for a failed charge fails the payment', async () => {
    verifyAnswer = { status: 'failed', amount: '1500.00', currency: 'ETB' };
    await signed(event());
    expect((await currentPayment()).status).toBe('FAILED');
    expect(await currentPlan()).toBe('FREE');
  });

  it('keeps the payment pending while Chapa still reports it pending', async () => {
    verifyAnswer = { status: 'pending', amount: '1500.00', currency: 'ETB' };
    await signed(event());
    expect((await currentPayment()).status).toBe('PENDING');
    expect(await currentPlan()).toBe('FREE');
  });

  it('refuses to activate when the verified amount does not match the plan price', async () => {
    verifyAnswer = { status: 'success', amount: '1.00', currency: plan.currency };
    await signed(event());
    expect((await currentPayment()).status).toBe('FAILED');
    expect(await currentPlan()).toBe('FREE');
  });

  it('duplicate and concurrent deliveries activate the subscription exactly once', async () => {
    await Promise.all([signed(event()), signed(event()), signed(event())]);
    const first = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });
    await signed(event()); // a retry hours later
    const after = await prisma.subscription.findUnique({ where: { organizationId: T.org.id } });

    expect(after.currentPeriodEnd.getTime()).toBe(first.currentPeriodEnd.getTime());
    expect(await prisma.payment.count({ where: { organizationId: T.org.id, status: 'SUCCEEDED' } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'PAYMENT_COMPLETED' } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { organizationId: T.org.id, action: 'SUBSCRIPTION_CHANGED' } })).toBe(1);
  });

  it('acknowledges events it does not handle (unknown tx_ref, payout events) without side effects', async () => {
    expect((await signed({ event: 'charge.success', tx_ref: 'tf_unknown_ref' })).status).toBe(200);
    expect((await signed({ event: 'payout.success', reference: 'abc' })).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await currentPayment()).status).toBe('PENDING');
  });

  it('never touches payments of another provider', async () => {
    await prisma.payment.update({ where: { id: payment.id }, data: { provider: 'MOCK' } }); // a historical non-Chapa row
    await signed(event());
    expect((await currentPayment()).status).toBe('PENDING');
  });
});

describe('Chapa callback_url (GET)', () => {
  it('ignores the status in the query string and verifies with Chapa instead', async () => {
    verifyAnswer = { status: 'pending', amount: '1500.00', currency: 'ETB' };
    const res = await request(app).get(`/api/v1/payments/webhooks/chapa?trx_ref=${payment.txRef}&ref_id=X&status=success`);
    expect(res.status).toBe(200);
    expect((await currentPayment()).status).toBe('PENDING');

    verifyAnswer = { status: 'success', amount: (plan.priceCents / 100).toFixed(2), currency: plan.currency };
    await request(app).get(`/api/v1/payments/webhooks/chapa?trx_ref=${payment.txRef}&ref_id=X&status=success`);
    expect((await currentPayment()).status).toBe('SUCCEEDED');
    expect(await currentPlan()).toBe('PROFESSIONAL');
  });
});
