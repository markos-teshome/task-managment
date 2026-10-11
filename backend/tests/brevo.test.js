import { describe, expect, it } from 'vitest';
import { createBrevoSender, parseAddress } from '../src/lib/brevo.js';

/** Records requests and answers with the given responses (no network). */
function fakeFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  };
  return { calls, fetchImpl };
}

describe('Brevo HTTPS email sender', () => {
  it('parses sender addresses', () => {
    expect(parseAddress('TeamFlow <ops@example.com>')).toEqual({ name: 'TeamFlow', email: 'ops@example.com' });
    expect(parseAddress('ops@example.com')).toEqual({ email: 'ops@example.com' });
  });

  it('sends the message in Brevo\'s format with the key only in the header', async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 201, body: { messageId: '<abc@smtp-relay.mailin.fr>' } });
    const brevo = createBrevoSender({ apiKey: 'xkeysib-test', from: 'TeamFlow <ops@example.com>', fetchImpl });
    const result = await brevo.send({ to: 'hana@example.com', subject: 'Hi', text: 'plain', html: '<p>html</p>' });
    expect(result).toEqual({ ok: true, messageId: '<abc@smtp-relay.mailin.fr>' });
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['api-key']).toBe('xkeysib-test');
    expect(calls[0].body).toEqual({
      sender: { name: 'TeamFlow', email: 'ops@example.com' }, to: [{ email: 'hana@example.com' }], subject: 'Hi', htmlContent: '<p>html</p>', textContent: 'plain',
    });
    expect(JSON.stringify(calls[0].body)).not.toContain('xkeysib-test');
  });

  it('reports refusals, network errors and timeouts without throwing', async () => {
    const { fetchImpl } = fakeFetch(
      { status: 400, body: { code: 'invalid_parameter', message: 'sender is not valid' } },
      new TypeError('fetch failed'),
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    );
    const brevo = createBrevoSender({ apiKey: 'k', from: 'ops@example.com', fetchImpl });
    expect(await brevo.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ ok: false, error: 'Brevo 400 invalid_parameter: sender is not valid' });
    expect(await brevo.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ ok: false, error: 'fetch failed' });
    expect((await brevo.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).error).toMatch(/did not answer within 15s/);
  });

  it('verifies the API key against the account endpoint', async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 200, body: { email: 'owner@example.com' } }, { status: 401, body: { code: 'unauthorized', message: 'Key not found' } });
    const brevo = createBrevoSender({ apiKey: 'k', from: 'ops@example.com', fetchImpl });
    expect(await brevo.verify()).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://api.brevo.com/v3/account');
    expect(await brevo.verify()).toEqual({ ok: false, error: 'Brevo 401 unauthorized: Key not found' });
  });
});
