import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { Errors } from '../../common/errors/AppError.js';
import { email, id, idParam, optionalText, pagination, platformPassword, searchTerm } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import { emailActionLimiter, loginLimiter, tokenLimiter } from '../../common/middleware/rateLimit.js';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { FEATURES } from '../../common/constants/plans.js';
import * as platform from './platform.service.js';
import * as platformAuth from './platformAuth.service.js';

/**
 * /api/v1/platform — TeamFlow operators only. Its own authorization boundary:
 *  - authenticated by the platform session cookie (never by a tenant access token);
 *  - state-changing requests must carry `X-TeamFlow-Client` (a custom header a cross-site form cannot send),
 *    on top of the SameSite=Strict cookie.
 */
const router = Router();

const clientMeta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function requireClientHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-teamflow-client')) return next();
  next(Errors.forbidden('Missing client header.', 'CSRF_PROTECTION'));
}

async function requirePlatformSession(req, _res, next) {
  const session = await platformAuth.resolvePlatformSession(req.cookies?.[platformAuth.PLATFORM_COOKIE]);
  if (!session) return next(Errors.unauthenticated('Please sign in to the platform console.', 'PLATFORM_SESSION_REQUIRED'));
  req.platformAdmin = session.admin;
  req.platformSession = session;
  next();
}

router.use(requireClientHeader);

// ── Sign-in (public) ──
router.post(
  '/auth/login',
  loginLimiter,
  validate({ body: z.object({ email, password: z.string().min(1).max(200) }).strict() }),
  async (req, res) => ok(res, await platformAuth.startLogin(req.valid.body, clientMeta(req))),
);

router.post(
  '/auth/verify',
  tokenLimiter,
  validate({ body: z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict() }),
  async (req, res) => {
    const { cookie, admin } = await platformAuth.completeLogin(req.valid.body, clientMeta(req));
    res.cookie(platformAuth.PLATFORM_COOKIE, cookie, platformAuth.platformCookieOptions());
    ok(res, { admin });
  },
);

// Password recovery (public). Only platform_admins are ever looked up; the answer never says whether one exists.
router.post('/auth/forgot-password', emailActionLimiter, validate({ body: z.object({ email }).strict() }), async (req, res) => {
  const work = platformAuth.requestPasswordReset(req.valid.body.email).catch((err) => logger.error({ err: err.message }, 'Platform password reset request failed'));
  if (config.isTest) await work; // answer without waiting (timing); tests wait to see the email
  ok(res, { message: "If an eligible administrator account exists with this email, you'll receive a reset link shortly." });
});

router.post(
  '/auth/reset-password',
  tokenLimiter,
  validate({ body: z.object({ token: z.string().min(20).max(200), password: platformPassword }).strict() }),
  async (req, res) => {
    await platformAuth.resetPassword(req.valid.body, clientMeta(req));
    ok(res, { message: 'Your password has been updated successfully. Please sign in again.' });
  },
);

router.post('/auth/logout', async (req, res) => {
  await platformAuth.logoutPlatform(req.cookies?.[platformAuth.PLATFORM_COOKIE]);
  const { maxAge: _maxAge, ...options } = platformAuth.platformCookieOptions();
  res.clearCookie(platformAuth.PLATFORM_COOKIE, options);
  ok(res, { message: 'Signed out.' });
});

// ── Everything below needs a platform session ──
router.use(requirePlatformSession);

router.get('/auth/me', (req, res) => ok(res, { admin: platformAuth.presentAdmin(req.platformAdmin), sessionExpiresAt: req.platformSession.expiresAt }));

const limit = z.number().int().min(1).max(100000).nullable();
const planFields = {
  name: z.string().trim().min(2).max(40),
  description: optionalText(200),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).toUpperCase().default('ETB'),
  maxUsers: limit,
  maxProjects: limit,
  maxBranches: limit,
  features: z.array(z.enum(Object.values(FEATURES))).transform((l) => [...new Set(l)]),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};
const createPlanBody = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,30}$/),
    ...planFields,
    maxBranches: limit.default(null),
    isActive: planFields.isActive.default(true),
    sortOrder: planFields.sortOrder.default(10),
  })
  .strict();
const updatePlanBody = z
  .object(Object.fromEntries(Object.entries(planFields).map(([k, v]) => [k, v.optional()])))
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const planCode = z.string().trim().toUpperCase().max(32).optional();

router.get('/overview', async (_req, res) => ok(res, await platform.overview()));
router.get('/health', async (_req, res) => ok(res, await platform.health()));

router.get(
  '/organizations',
  validate({
    query: z.object({
      ...pagination,
      search: searchTerm,
      status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
      planCode,
      closureRequested: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    }),
  }),
  async (req, res) => {
    const { items, meta } = await platform.listOrganizations(req.valid.query);
    ok(res, items, meta);
  },
);

router.get('/organizations/:id', validate({ params: idParam }), async (req, res) => ok(res, await platform.getOrganization(req.valid.params.id)));

router.patch(
  '/organizations/:id/status',
  validate({ params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']), reason: optionalText(500) }).strict() }),
  async (req, res) => ok(res, await platform.setOrganizationStatus(req.platformAdmin, req.valid.params.id, req.valid.body, req.ip)),
);

router.get(
  '/subscriptions',
  validate({
    query: z.object({
      ...pagination,
      status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELING']).optional(),
      planCode,
      endingWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    }),
  }),
  async (req, res) => {
    const { items, meta } = await platform.listSubscriptions(req.valid.query);
    ok(res, items, meta);
  },
);

router.get('/plans', async (_req, res) => ok(res, await platform.listAllPlans()));
router.post('/plans', validate({ body: createPlanBody }), async (req, res) => created(res, await platform.createPlan(req.platformAdmin, req.valid.body, req.ip)));
router.patch('/plans/:id', validate({ params: idParam, body: updatePlanBody }), async (req, res) => {
  ok(res, await platform.updatePlan(req.platformAdmin, req.valid.params.id, req.valid.body, req.ip));
});

router.get(
  '/payments',
  validate({
    query: z.object({
      ...pagination,
      search: searchTerm,
      status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']).optional(),
      organizationId: id.optional(),
    }),
  }),
  async (req, res) => {
    const { items, meta } = await platform.listPayments(req.valid.query);
    ok(res, items, meta);
  },
);

router.get(
  '/audit-logs',
  validate({ query: z.object({ ...pagination, action: z.string().max(60).optional(), organizationId: id.optional() }) }),
  async (req, res) => {
    const { items, meta } = await platform.listAuditLog(req.valid.query);
    ok(res, items, meta);
  },
);

export default router;
