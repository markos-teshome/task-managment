/**
 * Test double for Chapa's HTTP API, installed as globalThis.fetch for every test file.
 * The real Chapa provider code runs unchanged; only the network is replaced, so tests never
 * contact Chapa. Any other outbound HTTP call fails loudly.
 *
 *   chapaFake.settle(txRef, 'success' | 'failed' | 'pending' | 'cancelled')  — what Chapa's verify API will report.
 *   chapaFake.outage = 'network' | 'server' | null  — simulate Chapa being unreachable / returning 5xx.
 */
const CHAPA = 'https://api.chapa.co/v1';

export const chapaFake = {
  transactions: new Map(), // tx_ref → { amount, currency, status }
  outage: null,
  reset() {
    this.transactions.clear();
    this.outage = null;
  },
  settle(txRef, status) {
    const tx = this.transactions.get(txRef);
    if (!tx) throw new Error(`fake Chapa: unknown tx_ref ${txRef}`);
    tx.status = status;
  },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function fakeChapaFetch(url, options = {}) {
  const href = String(url);
  if (!href.startsWith(CHAPA)) throw new Error(`Unexpected outbound HTTP call in tests: ${href}`);
  const path = href.slice(CHAPA.length);
  if (chapaFake.outage === 'network') throw new TypeError('fetch failed');
  if (chapaFake.outage === 'server') return json({ message: 'Service unavailable', status: 'failed' }, 503);

  if (path === '/transaction/initialize' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    chapaFake.transactions.set(body.tx_ref, { amount: body.amount, currency: body.currency, status: 'pending' });
    return json({ message: 'Hosted Link', status: 'success', data: { checkout_url: `https://checkout.chapa.co/checkout/payment/${body.tx_ref}` } });
  }

  const verify = path.match(/^\/transaction\/verify\/(.+)$/);
  if (verify) {
    const txRef = decodeURIComponent(verify[1]);
    const tx = chapaFake.transactions.get(txRef);
    if (!tx) return json({ message: 'Invalid transaction or Transaction not found', status: 'failed', data: null }, 404);
    return json({ message: 'Payment details', status: 'success', data: { tx_ref: txRef, status: tx.status, amount: tx.amount, currency: tx.currency, reference: `TEST-${txRef}` } });
  }

  return json({ message: 'Not found', status: 'failed' }, 404);
}
