import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AppError, Errors } from '../../common/errors/AppError.js';
import { randomToken } from '../../common/utils/crypto.js';
import { fullName, paginate } from '../../common/utils/http.js';
import { assertPlanFitsUsage, activatePaidPlan } from '../subscriptions/subscription.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';
import { chapaProvider } from './providers/chapa.provider.js';

/**
 * Payment flow:  choose plan → checkout (PENDING) → provider → verify → SUCCEEDED → plan activated.
 *
 * States: PENDING → SUCCEEDED | FAILED | CANCELLED | EXPIRED. SUCCEEDED and FAILED are final.
 * A CANCELLED (superseded / abandoned) or EXPIRED checkout can still become SUCCEEDED, but only when
 * the provider verifies that the customer did pay — money that was taken is never ignored.
 *
 * Trust: a payment only succeeds through `processPayment`, which asks the provider for the
 * transaction's real status (server-to-server) and checks amount and currency.
 * Idempotency: every transition is a conditional update (`WHERE status = <the status we read>`) inside
 * the same transaction that activates the plan. A duplicate webhook, a double-clicked "verify" or a
 * webhook racing the return redirect finds the row already changed and does nothing.
 */
// Chapa is the payment provider. Rows from other providers (historical records) are read-only.
const PROVIDERS = { CHAPA: chapaProvider };
const providerFor = (payment) => PROVIDERS[payment.provider];

// A checkout not completed within this time is EXPIRED. Chapa may still report a late success.
export const CHECKOUT_TTL_MS = 60 * 60_000;
const SETTLEABLE = ['PENDING', 'CANCELLED', 'EXPIRED'];
const isStale = (payment) => Date.now() - payment.createdAt.getTime() > CHECKOUT_TTL_MS;
const EXPIRED_REASON = 'The checkout was not completed in time.';

/** Marks an organization's abandoned checkouts EXPIRED, so no payment stays "pending" forever. */
async function expireStaleCheckouts(organizationId) {
  await prisma.payment.updateMany({
    where: { organizationId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - CHECKOUT_TTL_MS) } },
    data: { status: 'EXPIRED', failureReason: EXPIRED_REASON },
  });
}

export const formatMoney = (cents, currency) =>
  `${currency} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const present = (p) => ({
  id: p.id,
  txRef: p.txRef,
  status: p.status,
  provider: p.provider,
  amountCents: p.amountCents,
  currency: p.currency,
  plan: p.plan ? { id: p.plan.id, code: p.plan.code, name: p.plan.name } : undefined,
  checkoutUrl: p.status === 'PENDING' ? p.checkoutUrl : null,
  failureReason: p.failureReason,
  initiatedBy: p.initiatedBy ? fullName(p.initiatedBy.user) : null,
  confirmedAt: p.confirmedAt,
  createdAt: p.createdAt,
});

const include = { plan: true, initiatedBy: { include: { user: { select: { firstName: true, lastName: true } } } } };

export async function listPayments(ctx, query) {
  const { skip, take, meta } = paginate(query);
  await expireStaleCheckouts(ctx.organizationId);
  const where = { organizationId: ctx.organizationId, ...(query.status && { status: query.status }) };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.payment.count({ where }),
  ]);
  return { items: items.map(present), meta: meta(total) };
}

async function findPayment(ctx, txRef) {
  await expireStaleCheckouts(ctx.organizationId);
  const payment = await prisma.payment.findFirst({ where: { txRef, organizationId: ctx.organizationId }, include });
  if (!payment) throw Errors.notFound('Payment');
  return payment;
}

export const getPayment = async (ctx, txRef) => present(await findPayment(ctx, txRef));

export async function startCheckout(ctx, { planId }) {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } });
  if (!plan) throw Errors.validation([{ field: 'planId', message: 'Select an available plan' }]);
  if (plan.priceCents <= 0) {
    throw Errors.badRequest('The Free plan does not require payment. Cancel your current plan to return to Free at the end of the period.');
  }
  await assertPlanFitsUsage(ctx.organizationId, plan);

  const provider = chapaProvider;
  const payment = await prisma.$transaction(async (tx) => {
    // Only one open checkout per organization: older pending attempts are abandoned.
    await tx.payment.updateMany({
      where: { organizationId: ctx.organizationId, status: 'PENDING' },
      data: { status: 'CANCELLED', failureReason: 'Superseded by a newer checkout.' },
    });
    const created = await tx.payment.create({
      data: {
        organizationId: ctx.organizationId,
        planId: plan.id,
        amountCents: plan.priceCents, // price is taken from the server, never from the client
        currency: plan.currency,
        provider: provider.name,
        txRef: `tf_${Date.now().toString(36)}_${randomToken(9)}`,
        initiatedById: ctx.membershipId,
      },
    });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.PAYMENT_INITIATED,
      entityType: 'PAYMENT',
      entityId: created.id,
      metadata: { plan: plan.name, amount: formatMoney(plan.priceCents, plan.currency) },
    });
    return created;
  });

  try {
    const init = await provider.initialize({
      payment,
      customer: ctx.user,
      returnUrl: `${config.APP_URL}/billing/return?tx_ref=${payment.txRef}`,
      callbackUrl: `${config.API_URL}/api/v1/payments/webhooks/chapa`,
    });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutUrl: init.checkoutUrl, providerReference: init.providerReference ?? null },
      include,
    });
    return present(updated);
  } catch (err) {
    logger.error({ err: err.message, txRef: payment.txRef }, 'Payment initialization failed');
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Could not reach the payment provider.' } });
    throw Errors.badRequest('The payment provider is unavailable right now. Please try again in a few minutes.', 'PAYMENT_PROVIDER_UNAVAILABLE');
  }
}

/**
 * The single, idempotent path that settles a payment. Safe to call any number of times,
 * from any trigger (return redirect, webhook, manual "check status").
 * Throws 503 PAYMENT_VERIFICATION_UNAVAILABLE when the provider cannot be reached: nothing changes and
 * the caller can retry (a webhook answers 5xx, so the provider retries it too).
 */
export async function processPayment(txRef) {
  const payment = await prisma.payment.findUnique({ where: { txRef }, include });
  if (!payment || !SETTLEABLE.includes(payment.status) || !providerFor(payment)) return payment;

  let result;
  try {
    result = await providerFor(payment).verify(payment);
  } catch (err) {
    logger.warn({ err: err.message, txRef }, 'Payment verification failed: provider unreachable');
    throw new AppError(
      503,
      'PAYMENT_VERIFICATION_UNAVAILABLE',
      "We couldn't reach the payment provider to confirm this payment. Nothing has changed — please check again in a moment.",
    );
  }

  if (result.status === 'SUCCEEDED' && (result.amountCents !== payment.amountCents || result.currency !== payment.currency)) {
    logger.warn({ txRef }, 'Payment amount/currency mismatch — refusing to activate');
    result = { status: 'FAILED', failureReason: 'The paid amount does not match the plan price.' };
  } else if (payment.status !== 'PENDING') {
    // A closed checkout only changes when the provider confirms the customer paid after all.
    if (result.status !== 'SUCCEEDED') return payment;
  } else if (result.status === 'PENDING') {
    if (!isStale(payment)) return payment;
    result = { status: 'EXPIRED', failureReason: EXPIRED_REASON };
  }

  await prisma.$transaction(async (tx) => {
    const succeeded = result.status === 'SUCCEEDED';
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: succeeded
        ? { status: 'SUCCEEDED', confirmedAt: new Date(), failureReason: null, providerReference: result.providerReference ?? payment.providerReference }
        : { status: result.status, failureReason: result.failureReason ?? 'Payment failed.' },
    });
    if (count !== 1) return; // already settled by a concurrent call — no side effects

    const base = { organizationId: payment.organizationId, actorId: payment.initiatedById, entityType: 'PAYMENT', entityId: payment.id };
    const amount = formatMoney(payment.amountCents, payment.currency);
    if (succeeded) {
      await logActivity(tx, { ...base, action: ACTIONS.PAYMENT_COMPLETED, metadata: { plan: payment.plan.name, amount } });
      await activatePaidPlan(tx, { organizationId: payment.organizationId, plan: payment.plan, actorId: payment.initiatedById });
    } else if (result.status === 'FAILED') {
      await logActivity(tx, { ...base, action: ACTIONS.PAYMENT_FAILED, metadata: { plan: payment.plan.name, amount } });
    }
  });

  return prisma.payment.findUnique({ where: { txRef }, include });
}

export async function verifyPayment(ctx, txRef) {
  await findPayment(ctx, txRef); // tenant scope check
  return present(await processPayment(txRef));
}

export async function cancelPayment(ctx, txRef) {
  const payment = await findPayment(ctx, txRef);
  if (payment.status !== 'PENDING') return present(payment);
  await prisma.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: 'CANCELLED', failureReason: 'Cancelled by the customer.' },
  });
  return getPayment(ctx, txRef);
}

/** Settles a Chapa payment by asking Chapa's verify API. Never acts on payments of other providers. */
async function settleChapaPayment(txRef) {
  if (typeof txRef !== 'string' || txRef.length > 100) return;
  const payment = await prisma.payment.findUnique({ where: { txRef }, select: { provider: true } });
  if (payment?.provider === 'CHAPA') await processPayment(txRef);
}

/** Chapa webhook (POST, configured in the dashboard): authenticate the sender, then re-verify with Chapa. */
export async function handleChapaWebhook(rawBody, headers, body) {
  if (!chapaProvider.verifyWebhookSignature(rawBody, headers, body)) {
    throw Errors.unauthenticated('Invalid webhook signature.', 'INVALID_SIGNATURE');
  }
  // Transfer/payout events carry no tx_ref and are acknowledged without action.
  await settleChapaPayment(body?.tx_ref ?? body?.trx_ref);
}

/**
 * Chapa callback (GET ?trx_ref=…&status=…, sent after checkout). Unsigned, so the `status` it carries is
 * ignored: it only triggers the same server-side verification as the webhook.
 */
export const handleChapaCallback = (query) => settleChapaPayment(query?.trx_ref ?? query?.tx_ref);
