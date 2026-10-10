import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuthenticate } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { emailActionLimiter, loginLimiter, registerLimiter, tokenLimiter } from '../../common/middleware/rateLimit.js';
import { email, id, password, personName } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './tokens.js';
import * as auth from './auth.service.js';

const router = Router();

const token = z.string().min(20).max(200);

const schemas = {
  register: z.object({ firstName: personName, lastName: personName, email, password }).strict(),
  login: z.object({ email, password: z.string().min(1, 'Password is required').max(200) }).strict(),
  emailOnly: z.object({ email }).strict(),
  token: z.object({ token }).strict(),
  reset: z.object({ token, password }).strict(),
  // `password` is the new password for a new account, or the current one for an existing account.
  accept: z
    .object({
      token,
      password: z.string().min(1).max(200).optional(),
      firstName: personName.optional(),
      lastName: personName.optional(),
    })
    .strict(),
  profile: z.object({ firstName: personName, lastName: personName }).strict(),
  changePassword: z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).strict(),
  switch: z.object({ membershipId: id }).strict(),
};

const clientMeta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

const setRefreshCookie = (res, value) => res.cookie(REFRESH_COOKIE, value, refreshCookieOptions());
const clearRefreshCookie = (res) => {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, options);
};

const GENERIC = {
  register: 'If this email can be used, we have sent a verification link. Check your inbox to continue.',
  resend: 'If this account needs verification, a new link is on its way.',
  forgot: 'If an account exists for this email, we have sent a password reset link.',
};

router.post('/register', registerLimiter, validate({ body: schemas.register }), async (req, res) => {
  await auth.register(req.valid.body);
  created(res, { message: GENERIC.register });
});

router.post('/verify-email', tokenLimiter, validate({ body: schemas.token }), async (req, res) => {
  await auth.verifyEmail(req.valid.body.token);
  ok(res, { message: 'Your email is verified. You can now sign in.' });
});

router.post('/resend-verification', emailActionLimiter, validate({ body: schemas.emailOnly }), async (req, res) => {
  await auth.resendVerification(req.valid.body.email);
  ok(res, { message: GENERIC.resend });
});

router.post('/login', loginLimiter, validate({ body: schemas.login }), async (req, res) => {
  const { refreshToken, ...session } = await auth.login(req.valid.body, clientMeta(req));
  setRefreshCookie(res, refreshToken);
  ok(res, session);
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, ...session } = await auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    setRefreshCookie(res, refreshToken);
    ok(res, session);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  ok(res, { message: 'Signed out.' });
});

router.post('/forgot-password', emailActionLimiter, validate({ body: schemas.emailOnly }), async (req, res) => {
  await auth.forgotPassword(req.valid.body.email);
  ok(res, { message: GENERIC.forgot });
});

router.post('/reset-password', tokenLimiter, validate({ body: schemas.reset }), async (req, res) => {
  await auth.resetPassword(req.valid.body);
  clearRefreshCookie(res);
  ok(res, { message: 'Your password has been reset. Sign in with your new password.' });
});

router.get('/invitations/:token', tokenLimiter, validate({ params: z.object({ token }) }), async (req, res) => {
  ok(res, await auth.getInvitation(req.valid.params.token));
});

// Signed-in callers may only accept invitations addressed to their own account.
router.post('/accept-invitation', tokenLimiter, optionalAuthenticate, validate({ body: schemas.accept }), async (req, res) => {
  ok(res, await auth.acceptInvitation(req.valid.body, req.ctx));
});

// ── Authenticated ──

router.get('/me', authenticate, async (req, res) => {
  ok(res, await auth.buildMe(req.ctx));
});

router.patch('/me', authenticate, validate({ body: schemas.profile }), async (req, res) => {
  ok(res, await auth.updateProfile(req.ctx, req.valid.body));
});

router.post('/change-password', authenticate, validate({ body: schemas.changePassword }), async (req, res) => {
  await auth.changePassword(req.ctx, req.valid.body);
  ok(res, { message: 'Password changed. Other devices have been signed out.' });
});

router.post('/switch-workspace', authenticate, validate({ body: schemas.switch }), async (req, res) => {
  ok(res, await auth.switchSessionWorkspace(req.ctx, req.valid.body.membershipId));
});

export default router;
