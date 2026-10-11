import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AppError, Errors } from '../../common/errors/AppError.js';
import { burnPasswordCheck, hashPassword, randomToken, safeEqual, sha256, verifyPassword } from '../../common/utils/crypto.js';
import { sendPlatformLoginCode, sendPlatformPasswordChangedEmail, sendPlatformPasswordResetEmail } from '../auth/auth.emails.js';

/**
 * Platform (super admin) authentication — completely separate from tenant sign-in:
 *  - its own identity table (platform_admins), never a tenant user or membership;
 *  - two factors: password, then a 6-digit code emailed to the admin (10 min, 5 attempts, single use);
 *  - its own short session: an httpOnly, SameSite=Strict cookie scoped to /api/v1/platform, 8 h absolute
 *    and 30 min idle lifetime, checked against the database on every request.
 * A platform session is never accepted by tenant APIs, and a tenant session is never accepted here.
 */

export const PLATFORM_COOKIE = 'tf_platform';
const SESSION_TTL_MS = 8 * 3_600_000;
const IDLE_TTL_MS = 30 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_FAILED_PASSWORDS = 5;
const LOCK_MINUTES = 15;

export const platformCookieOptions = () => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/v1/platform',
  maxAge: SESSION_TTL_MS,
});

export const presentAdmin = (a) => ({ id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, name: `${a.firstName} ${a.lastName}` });

/** Shows enough of the address to recognise it without revealing it to an onlooker: a•••@teamflow.test */
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

const codeHash = (challengeId, code) => sha256(`${challengeId}:${code}`);
const invalidCredentials = () => Errors.unauthenticated('Incorrect email or password.', 'INVALID_CREDENTIALS');

/** Step 1: password. On success a one-time code is emailed and a challenge id returned. */
export async function startLogin({ email, password }, meta) {
  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!admin) {
    await burnPasswordCheck(password); // same timing as a real check
    throw invalidCredentials();
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw Errors.tooMany(`Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`, 'ACCOUNT_LOCKED');
  }
  if (!(await verifyPassword(password, admin.passwordHash))) {
    const attempts = admin.failedLoginAttempts + 1;
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: attempts >= MAX_FAILED_PASSWORDS
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLoginAttempts: attempts },
    });
    logger.warn({ adminId: admin.id, ip: meta.ip }, 'Platform sign-in: wrong password');
    throw invalidCredentials();
  }
  if (admin.status !== 'ACTIVE') throw Errors.forbidden('This platform account has been disabled.', 'ACCOUNT_DISABLED');

  const id = crypto.randomUUID();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.$transaction([
    prisma.platformLoginChallenge.deleteMany({ where: { adminId: admin.id, usedAt: null } }), // only the newest code works
    prisma.platformLoginChallenge.create({ data: { id, adminId: admin.id, codeHash: codeHash(id, code), expiresAt } }),
  ]);
  if (!(await sendPlatformLoginCode(admin, code))) {
    await prisma.platformLoginChallenge.delete({ where: { id } });
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', "We couldn't send your sign-in code. Please try again in a few minutes.");
  }
  return { challengeId: id, expiresAt, sentTo: maskEmail(admin.email) };
}

/** Step 2: the emailed code. Creates the platform session. */
export async function completeLogin({ challengeId, code }, meta) {
  const invalid = Errors.unauthenticated('This code is invalid or has expired. Sign in again to get a new one.', 'INVALID_CODE');
  const challenge = await prisma.platformLoginChallenge.findUnique({ where: { id: challengeId }, include: { admin: true } });
  if (!challenge || challenge.usedAt || challenge.expiresAt < new Date() || challenge.attempts >= MAX_CODE_ATTEMPTS) throw invalid;
  if (challenge.admin.status !== 'ACTIVE') throw invalid;

  if (!safeEqual(codeHash(challenge.id, code), challenge.codeHash)) {
    await prisma.platformLoginChallenge.updateMany({ where: { id: challenge.id, attempts: { lt: MAX_CODE_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    const left = MAX_CODE_ATTEMPTS - challenge.attempts - 1;
    logger.warn({ adminId: challenge.adminId, ip: meta.ip }, 'Platform sign-in: wrong code');
    throw left > 0 ? Errors.unauthenticated(`That code is not correct. ${left} attempt(s) left.`, 'INVALID_CODE') : invalid;
  }

  const secret = randomToken(48);
  const session = await prisma.$transaction(async (tx) => {
    const { count } = await tx.platformLoginChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: new Date() } });
    if (count !== 1) throw invalid; // the same code submitted twice at once
    await tx.platformAdmin.update({ where: { id: challenge.adminId }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    const created = await tx.platformSession.create({
      data: {
        adminId: challenge.adminId,
        secretHash: sha256(secret),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    await tx.platformAuditLog.create({
      data: { actorId: challenge.adminId, action: 'PLATFORM_SIGNED_IN', targetType: 'PLATFORM_ADMIN', targetId: challenge.adminId, ipAddress: meta.ip, metadata: {} },
    });
    return created;
  });
  return { cookie: `${session.id}.${secret}`, admin: presentAdmin(challenge.admin) };
}

const parseCookie = (raw) => {
  if (typeof raw !== 'string') return null;
  const [id, secret] = raw.split('.');
  return id && secret && /^[0-9a-f-]{36}$/i.test(id) ? { id, secret } : null;
};

/** Resolves a platform session from its cookie, enforcing absolute and idle expiry. Returns null if not valid. */
export async function resolvePlatformSession(rawCookie) {
  const parsed = parseCookie(rawCookie);
  if (!parsed) return null;
  const session = await prisma.platformSession.findUnique({ where: { id: parsed.id }, include: { admin: true } });
  const now = Date.now();
  if (!session || session.revokedAt || !safeEqual(sha256(parsed.secret), session.secretHash)) return null;
  if (session.expiresAt.getTime() < now || now - session.lastUsedAt.getTime() > IDLE_TTL_MS || session.admin.status !== 'ACTIVE') {
    if (!session.revokedAt) await prisma.platformSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  // Sliding idle window, written at most once a minute.
  if (now - session.lastUsedAt.getTime() > 60_000) await prisma.platformSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  return session;
}

export async function logoutPlatform(rawCookie) {
  const parsed = parseCookie(rawCookie);
  if (parsed) await prisma.platformSession.updateMany({ where: { id: parsed.id, revokedAt: null }, data: { revokedAt: new Date() } });
}

// ─────────────────────────── Password recovery ───────────────────────────

const RESET_TTL_MS = 15 * 60_000;
const RESET_COOLDOWN_MS = 60_000;
const invalidResetLink = () =>
  Errors.badRequest('This password reset link is invalid or has expired. Please request a new one.', 'INVALID_TOKEN');

/**
 * Emails a reset link to an active platform admin. Same generic answer for everyone (the route doesn't wait
 * for this), nothing for unknown or disabled accounts, at most one email a minute per admin, and a new link
 * replaces any outstanding one. Tenant users are a different table: their emails never match here.
 */
export async function requestPasswordReset(email) {
  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!admin || admin.status !== 'ACTIVE') return;
  const recent = await prisma.platformPasswordReset.count({
    where: { adminId: admin.id, usedAt: null, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
  });
  if (recent) return;
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.platformPasswordReset.deleteMany({ where: { adminId: admin.id, usedAt: null } }),
    prisma.platformPasswordReset.create({ data: { adminId: admin.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } }),
  ]);
  if (!(await sendPlatformPasswordResetEmail(admin, token))) logger.warn({ adminId: admin.id }, 'Platform password reset email was not accepted by SMTP');
}

/**
 * Sets a new password from a reset link. The link is consumed atomically (two simultaneous uses: one wins),
 * every platform session and pending sign-in code is revoked, and nothing else changes: the account is not
 * signed in, a disabled admin stays disabled, a temporary lockout stays, and the emailed sign-in code is still
 * required at the next sign-in.
 */
export async function resetPassword({ token, password }, meta) {
  const reset = await prisma.platformPasswordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: true } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || reset.admin.status !== 'ACTIVE') throw invalidResetLink();
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.platformPasswordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
    if (count !== 1) throw invalidResetLink();
    await tx.platformAdmin.update({ where: { id: reset.adminId }, data: { passwordHash } });
    await tx.platformSession.updateMany({ where: { adminId: reset.adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.platformLoginChallenge.deleteMany({ where: { adminId: reset.adminId, usedAt: null } });
    await tx.platformAuditLog.create({
      data: { actorId: reset.adminId, action: 'PLATFORM_ADMIN_PASSWORD_RESET', targetType: 'PLATFORM_ADMIN', targetId: reset.adminId, ipAddress: meta.ip, metadata: { email: reset.admin.email, via: 'email link' } },
    });
  });
  logger.info({ adminId: reset.adminId, ip: meta.ip }, 'Platform admin password reset');
  await sendPlatformPasswordChangedEmail(reset.admin);
}
