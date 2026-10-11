import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

/** Loads the real configuration module in a child process with the given environment. */
function boot(env) {
  const base = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_ACCESS_SECRET: 'x'.repeat(40), CHAPA_SECRET_KEY: 'CHASECK_TEST-x',
    SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', DOTENV_CONFIG_PATH: 'does-not-exist.env',
  };
  return spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then(() => console.log('CONFIG_OK'))"], { env: { ...base, ...env }, encoding: 'utf8' });
}

describe('production configuration checks', () => {
  const prod = { NODE_ENV: 'production', APP_URL: 'https://app.example.com', API_URL: 'https://app.example.com', COOKIE_SECURE: 'true' };

  it('a correct production configuration starts (with SMTP, or with Brevo instead of SMTP)', () => {
    expect(boot(prod).stdout).toContain('CONFIG_OK');
    const brevoOnly = boot({ ...prod, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: 'xkeysib-x', MAIL_FROM: 'TeamFlow <ops@example.com>' });
    expect(brevoOnly.stdout).toContain('CONFIG_OK');
  });

  it.each([
    ['insecure cookies', { COOKIE_SECURE: 'false' }, 'COOKIE_SECURE must be true'],
    ['http frontend URL', { APP_URL: 'http://app.example.com' }, 'APP_URL must use https://'],
    ['http API URL', { API_URL: 'http://app.example.com' }, 'API_URL must use https://'],
    ['localhost links', { APP_URL: 'https://localhost' }, 'APP_URL points to localhost'],
    ['live Chapa key without approval', { CHAPA_SECRET_KEY: 'CHASECK-live-key' }, 'CHAPA_SECRET_KEY is a live key'],
    ['short JWT secret', { JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET must be at least 32 characters'],
    ['no email at all', { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' }, 'Email is required'],
    ['Brevo without a sender', { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: 'xkeysib-x' }, 'set MAIL_FROM'],
  ])('refuses to start with %s', (_name, override, message) => {
    const r = boot({ ...prod, ...override });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.stdout).not.toContain('CONFIG_OK');
  });
});
