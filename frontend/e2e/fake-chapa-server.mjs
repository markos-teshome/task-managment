/**
 * Fake Chapa for end-to-end tests only (never used by the application at runtime).
 * Mimics the parts of Chapa that TeamFlow talks to, so browser tests don't depend on a live service:
 *   POST /v1/transaction/initialize      → returns a hosted checkout URL on this server
 *   GET  /v1/transaction/verify/:tx_ref  → reports the transaction status
 *   GET  /checkout/:tx_ref               → hosted checkout page with Pay / Decline
 *   POST /checkout/:tx_ref/:outcome      → records the outcome, calls TeamFlow's callback_url like
 *                                          Chapa does (GET ?trx_ref=…&status=…), then redirects to return_url
 */
import http from 'node:http';

const PORT = Number(process.env.FAKE_CHAPA_PORT ?? 4900);
const tx = new Map();

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => (data += c)).on('end', () => resolve(data));
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

    if (req.method === 'POST' && url.pathname === '/v1/transaction/initialize') {
      if (!/^Bearer CHASECK_TEST-/.test(req.headers.authorization ?? '')) return send(res, 401, { status: 'failed', message: 'Invalid API Key' });
      const body = JSON.parse(await readBody(req));
      tx.set(body.tx_ref, { ...body, status: 'pending' });
      return send(res, 200, { status: 'success', message: 'Hosted Link', data: { checkout_url: `http://localhost:${PORT}/checkout/${encodeURIComponent(body.tx_ref)}` } });
    }

    const verify = url.pathname.match(/^\/v1\/transaction\/verify\/(.+)$/);
    if (req.method === 'GET' && verify) {
      const t = tx.get(decodeURIComponent(verify[1]));
      if (!t) return send(res, 404, { status: 'failed', message: 'Transaction not found', data: null });
      return send(res, 200, { status: 'success', message: 'Payment details', data: { tx_ref: t.tx_ref, status: t.status, amount: t.amount, currency: t.currency, reference: `FAKE-${t.tx_ref}` } });
    }

    const page = url.pathname.match(/^\/checkout\/([^/]+)$/);
    if (req.method === 'GET' && page) {
      const t = tx.get(decodeURIComponent(page[1]));
      if (!t) return send(res, 404, 'Unknown transaction', 'text/plain');
      return send(res, 200, `<!doctype html><title>Chapa test checkout</title><main style="font-family:sans-serif;max-width:420px;margin:60px auto">
<h1>Chapa test checkout</h1><p>Automated-test stand-in for Chapa's hosted page.</p><p>${esc(t.currency)} ${esc(t.amount)}</p>
<form method="post" action="/checkout/${encodeURIComponent(t.tx_ref)}/success"><button>Pay ${esc(t.currency)} ${esc(t.amount)}</button></form>
<form method="post" action="/checkout/${encodeURIComponent(t.tx_ref)}/failed"><button>Decline</button></form></main>`, 'text/html');
    }

    const decide = url.pathname.match(/^\/checkout\/([^/]+)\/(success|failed)$/);
    if (req.method === 'POST' && decide) {
      const t = tx.get(decodeURIComponent(decide[1]));
      if (!t) return send(res, 404, 'Unknown transaction', 'text/plain');
      t.status = decide[2];
      // Like Chapa: server-to-server callback first, then send the customer back.
      if (t.callback_url) await fetch(`${t.callback_url}?trx_ref=${encodeURIComponent(t.tx_ref)}&ref_id=FAKE&status=${t.status}`).catch(() => {});
      res.writeHead(303, { Location: t.return_url });
      return res.end();
    }

    send(res, 404, { status: 'failed', message: 'Not found' });
  })
  .listen(PORT, () => console.log(`fake Chapa listening on ${PORT}`));
