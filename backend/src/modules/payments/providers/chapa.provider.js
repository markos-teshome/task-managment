import crypto from 'node:crypto';
import { config } from '../../../config/env.js';
import { safeEqual } from '../../../common/utils/crypto.js';

/**
 * Chapa (https://developer.chapa.co) hosted checkout.
 *  initialize → POST /transaction/initialize, returns checkout_url
 *  verify     → GET  /transaction/verify/:tx_ref (server-to-server; the source of truth)
 *  webhook    → HMAC-SHA256 signature check, then verify() again before trusting anything.
 */
async function chapaFetch(path, options = {}) {
  const res = await fetch(`${config.CHAPA_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.CHAPA_SECRET_KEY}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

const toMajor = (cents) => (cents / 100).toFixed(2);

// Chapa rejects addresses on reserved, non-deliverable domains (RFC 2606/6761), e.g. the seeded
// demo accounts (@*.test). The field is optional, so such addresses are simply not sent.
const deliverableEmail = (email) => (/\.(test|example|invalid|localhost|local)$/i.test(email.split('@')[1] ?? '') ? undefined : email);

export const chapaProvider = {
  name: 'CHAPA',

  async initialize({ payment, customer, returnUrl, callbackUrl }) {
    const { ok, body } = await chapaFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        amount: toMajor(payment.amountCents),
        currency: payment.currency,
        email: deliverableEmail(customer.email),
        first_name: customer.firstName,
        last_name: customer.lastName,
        tx_ref: payment.txRef,
        callback_url: callbackUrl,
        return_url: returnUrl,
        customization: { title: 'TeamFlow', description: 'Subscription payment' },
      }),
    });
    if (!ok || body.status !== 'success' || !body.data?.checkout_url) {
      // Chapa returns validation errors as an object (field → messages); keep them readable in the log.
      const reason = typeof body.message === 'string' ? body.message : JSON.stringify(body.message ?? body);
      throw new Error(`Chapa initialize failed: ${reason}`);
    }
    return { checkoutUrl: body.data.checkout_url };
  },

  async verify(payment) {
    const { ok, body } = await chapaFetch(`/transaction/verify/${encodeURIComponent(payment.txRef)}`);
    if (!ok || body.status !== 'success' || !body.data) return { status: 'PENDING' };
    const status = String(body.data.status).toLowerCase();
    if (status === 'success') {
      return {
        status: 'SUCCEEDED',
        amountCents: Math.round(Number(body.data.amount) * 100),
        currency: body.data.currency,
        providerReference: body.data.reference ?? null,
      };
    }
    if (status === 'failed') return { status: 'FAILED', failureReason: 'Payment failed at Chapa.' };
    return { status: 'PENDING' };
  },

  /**
   * Chapa signs with the "Secret hash" set in the dashboard (CHAPA_WEBHOOK_SECRET) and sends two headers;
   * one valid header is enough (per Chapa's docs):
   *  - x-chapa-signature = HMAC-SHA256(secret, payload)  — checked against the raw body and its JSON form;
   *  - chapa-signature   = HMAC-SHA256(secret, secret)   — proves the sender knows the secret.
   * Neither is trusted for the outcome: the payment is always re-verified with Chapa's API afterwards.
   */
  verifyWebhookSignature(rawBody, headers, body) {
    const secret = config.CHAPA_WEBHOOK_SECRET;
    if (!secret) return false;
    const hmac = (data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

    const payloadSig = headers['x-chapa-signature'];
    if (payloadSig && rawBody && (safeEqual(hmac(rawBody), payloadSig) || safeEqual(hmac(JSON.stringify(body)), payloadSig))) {
      return true;
    }
    const secretSig = headers['chapa-signature'];
    return !!secretSig && safeEqual(hmac(secret), secretSig);
  },
};
