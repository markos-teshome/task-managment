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
  // Migrations only: a direct (non-pooled) connection. Neon's pooled "-pooler" address can leave Prisma's
  // migration lock stuck; set this to the same URL without "-pooler". Falls back to DATABASE_URL.
  DIRECT_URL: z.string().optional(),

  // One-service deployment: this API also serves the built frontend (frontend/dist) on the same address,
  // so the session cookie stays same-site and no CORS is needed.
  SERVE_FRONTEND: bool.default('false'),
  // Number of proxies in front of this API (for the real client IP used by rate limits):
  // Count them from the request logs' x-forwarded-for: Render alone = 3 (Cloudflare + 2 Render hops);
  // Vercel rewrite → Render = 4. Default 1 = a single load balancer.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

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
  // Email over HTTPS instead of SMTP (for hosts that block SMTP ports, e.g. Render's free plan). When set, it is
  // used instead of SMTP; MAIL_FROM (or SMTP_USER) must be a sender verified in Brevo.
  BREVO_API_KEY: z.string().optional(),
});

const fail = (message) => {
  console.error(`Invalid environment configuration:\n${message}`);
  process.exit(1);
};

const parsed = schema.safeParse(process.env);
if (!parsed.success) fail(parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));

const env = parsed.data;
const isTest = env.NODE_ENV === 'test';

if (!isTest && !env.BREVO_API_KEY && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)) {
  fail('  - Email is required: set BREVO_API_KEY (HTTPS) or SMTP_HOST, SMTP_USER and SMTP_PASS — verification, password-reset and invitation emails depend on it.');
}
if (!isTest && env.BREVO_API_KEY && !(env.MAIL_FROM || env.SMTP_USER)) {
  fail('  - With BREVO_API_KEY, set MAIL_FROM to the sender address verified in Brevo, e.g. MAIL_FROM=TeamFlow <you@gmail.com>.');
}

const isLocalUrl = (url) => ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(new URL(url).hostname);

// A production deployment must not email links that only work on the server itself.
if (env.NODE_ENV === 'production' && isLocalUrl(env.APP_URL)) {
  fail('  - APP_URL points to localhost. In production it must be the public frontend URL used in email links.');
}

// Production must run over HTTPS with secure cookies (sessions would otherwise travel in clear text).
if (env.NODE_ENV === 'production') {
  if (!env.COOKIE_SECURE) fail('  - COOKIE_SECURE must be true in production (HTTPS only session cookies).');
  if (new URL(env.APP_URL).protocol !== 'https:') fail('  - APP_URL must use https:// in production.');
  if (new URL(env.API_URL).protocol !== 'https:') fail('  - API_URL must use https:// in production (Chapa calls it).');
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
