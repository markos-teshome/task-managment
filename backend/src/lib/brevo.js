/**
 * Brevo transactional email over HTTPS (https://developers.brevo.com/reference/sendtransacemail).
 * Used where SMTP ports are blocked (e.g. Render's free plan). The sender address must be a verified sender
 * in the Brevo account. The API key is only ever sent in the request header — never logged.
 */
const API = 'https://api.brevo.com/v3';

/** "TeamFlow <ops@example.com>" or "ops@example.com" → { name, email } */
export function parseAddress(value) {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value ?? '');
  if (match) return { name: match[1]?.trim() || undefined, email: match[2].trim() };
  return { email: String(value ?? '').trim() };
}

export function createBrevoSender({ apiKey, from, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const sender = parseAddress(from);
  const call = (path, init) =>
    fetchImpl(`${API}${path}`, {
      ...init,
      headers: { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  const reason = async (res) => {
    const body = await res.json().catch(() => null);
    return `Brevo ${res.status}${body?.code ? ` ${body.code}` : ''}${body?.message ? `: ${body.message}` : ''}`;
  };

  return {
    sender,
    /** Resolves { ok: true, messageId } when Brevo accepted the message, or { ok: false, error }. Never throws. */
    async send({ to, subject, text, html }) {
      try {
        const res = await call('/smtp/email', {
          method: 'POST',
          body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
        });
        if (!res.ok) return { ok: false, error: await reason(res) };
        const body = await res.json().catch(() => ({}));
        return { ok: true, messageId: body.messageId ?? null };
      } catch (err) {
        return { ok: false, error: err.name === 'TimeoutError' ? `Brevo did not answer within ${timeoutMs / 1000}s` : err.message };
      }
    },
    /** Checks the API key (GET /account). Resolves { ok } or { ok: false, error }. */
    async verify() {
      try {
        const res = await call('/account', { method: 'GET' });
        return res.ok ? { ok: true } : { ok: false, error: await reason(res) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}
