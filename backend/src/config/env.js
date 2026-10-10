import 'dotenv/config';
import { z } from 'zod';

// Fail fast on bad configuration instead of discovering it at the first request.
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // APP_URL  = the frontend people open; every link in an email points here (must reach the recipient's device).
  // API_URL  = this API as reachable by Chapa (webhook + callback). It may be the same origin as APP_URL when
  //            the frontend proxies /api (the Vite dev server does). Trailing slashes are removed.
  APP_URL: z.string().url().default('http://localhost:5173').transform((u) => u.replace(/\/+$/, '')),
  API_URL: z.string().url().default('http://localhost:4000').transform((u) => u.replace(/\/+$/, '')),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: bool.default('false'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RATE_LIMIT_ENABLED: bool.default('true'),

  // Payments: Chapa is the payment provider.
  CHAPA_SECRET_KEY: z.string().min(1, 'CHAPA_SECRET_KEY is required (Chapa dashboard → Settings → API keys)'),
  CHAPA_WEBHOOK_SECRET: z.string().optional(),
  CHAPA_BASE_URL: z.string().url().default('https://api.chapa.co/v1'),
  CHAPA_ALLOW_LIVE: bool.default('false'),

  // Email: real SMTP delivery (required outside automated tests).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

const fail = (message) => {
  console.error(`Invalid environment configuration:\n${message}`);
  process.exit(1);
};

const parsed = schema.safeParse(process.env);
if (!parsed.success) fail(parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));

const env = parsed.data;
const isTest = env.NODE_ENV === 'test';

if (!isTest && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)) {
  fail('  - SMTP_HOST, SMTP_USER and SMTP_PASS are required: verification, password-reset and invitation emails are sent by SMTP.');
}

const isLocalUrl = (url) => ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(new URL(url).hostname);

// A production deployment must not email links that only work on the server itself.
if (env.NODE_ENV === 'production' && isLocalUrl(env.APP_URL)) {
  fail('  - APP_URL points to localhost. In production it must be the public frontend URL used in email links.');
}

// Live payments only with explicit approval: a live key must be paired with CHAPA_ALLOW_LIVE=true.
if (!env.CHAPA_SECRET_KEY.startsWith('CHASECK_TEST-') && !env.CHAPA_ALLOW_LIVE) {
  fail('  - CHAPA_SECRET_KEY is a live key. Use a CHASECK_TEST- key, or set CHAPA_ALLOW_LIVE=true to accept real payments.');
}

export const config = {
  ...env,
  // Most SMTP providers (incl. Gmail) only send as the authenticated account.
  MAIL_FROM: env.MAIL_FROM || (env.SMTP_USER ? `TeamFlow <${env.SMTP_USER}>` : 'TeamFlow <no-reply@localhost>'),
  chapaTestMode: env.CHAPA_SECRET_KEY.startsWith('CHASECK_TEST-'),
  appUrlIsLocal: isLocalUrl(env.APP_URL),
  apiUrlIsLocal: isLocalUrl(env.API_URL),
  isProd: env.NODE_ENV === 'production',
  isTest,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
};
