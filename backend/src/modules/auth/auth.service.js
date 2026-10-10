import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { Errors } from '../../common/errors/AppError.js';
import { burnPasswordCheck, hashPassword, safeEqual, sha256, verifyPassword } from '../../common/utils/crypto.js';
import { fullName } from '../../common/utils/http.js';
import { password as passwordRule } from '../../common/validators/index.js';
import { newRefreshSecret, parseRefreshToken, signAccessToken } from './tokens.js';
import { loadSessionContext } from './context.js';
import { consumeToken, findValidToken, issueAuthToken } from './authToken.service.js';
import { sendAlreadyRegisteredEmail, sendPasswordResetEmail, sendVerificationEmail } from './auth.emails.js';
import { getEntitlementSummary } from '../subscriptions/entitlement.service.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 1;
const REUSE_GRACE_MS = 15_000;

// ─────────────────────────── Registration & verification ───────────────────────────

/**
 * Registration creates only the identity. The organization is created after verification
 * (POST /organizations), so unverified sign-ups never create tenants.
 * The response is the same whether or not the email exists (no account enumeration);
 * an existing user instead receives an email telling them they already have an account.
 */
export async function register({ firstName, lastName, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.passwordHash) {
    if (existing.emailVerifiedAt) {
      await sendAlreadyRegisteredEmail(existing);
    } else {
      const token = await issueAuthToken(prisma, { userId: existing.id, type: 'EMAIL_VERIFICATION' });
      await sendVerificationEmail(existing, token);
    }
    return;
  }

  // A user that exists without a password was invited but never accepted: let them claim it.
  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { firstName, lastName, passwordHash } })
    : await prisma.user.create({ data: { firstName, lastName, email, passwordHash } });

  const token = await issueAuthToken(prisma, { userId: user.id, type: 'EMAIL_VERIFICATION' });
  await sendVerificationEmail(user, token);
}

export async function verifyEmail(rawToken) {
  const token = await findValidToken(rawToken, 'EMAIL_VERIFICATION');
  await prisma.$transaction(async (tx) => {
    await consumeToken(tx, token.id, 'EMAIL_VERIFICATION');
    await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: token.user.emailVerifiedAt ?? new Date() } });
  });
}

export async function resendVerification(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || !user.passwordHash) return; // generic response either way
  const token = await issueAuthToken(prisma, { userId: user.id, type: 'EMAIL_VERIFICATION' });
  await sendVerificationEmail(user, token);
}

// ─────────────────────────────── Sessions ───────────────────────────────

/** The workspace a fresh login lands in: the most recently used active one. */
async function defaultMembershipId(userId) {
  const usable = { status: 'ACTIVE', organization: { status: 'ACTIVE' } };
  const recent = await prisma.session.findFirst({
    where: { userId, membership: usable },
    orderBy: { lastUsedAt: 'desc' },
    select: { membershipId: true },
  });
  if (recent) return recent.membershipId;
  const any = await prisma.membership.findFirst({ where: { userId, ...usable }, orderBy: { joinedAt: 'desc' } });
  return any?.id ?? null;
}

async function createSession(userId, meta) {
  const { secret, hash } = newRefreshSecret();
  const session = await prisma.session.create({
    data: {
      userId,
      membershipId: await defaultMembershipId(userId),
      refreshTokenHash: hash,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ip,
    },
  });
  return { session, refreshToken: `${session.id}.${secret}` };
}

async function sessionResponse(sessionId) {
  const ctx = await loadSessionContext(sessionId);
  return { accessToken: signAccessToken({ userId: ctx.userId, sessionId }), me: await buildMe(ctx) };
}

/** Counts a wrong password; enough of them lock the account for a while. */
async function recordFailedPassword(user) {
  const attempts = user.failedLoginAttempts + 1;
  await prisma.user.update({
    where: { id: user.id },
    data:
      attempts >= MAX_FAILED_LOGINS
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLoginAttempts: attempts },
  });
}

const accountLocked = () =>
  Errors.tooMany(`Too many failed sign-in attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`, 'ACCOUNT_LOCKED');

export async function login({ email, password }, meta) {
  const user = await prisma.user.findUnique({ where: { email } });
  const invalid = Errors.unauthenticated('Incorrect email or password.', 'INVALID_CREDENTIALS');

  if (!user?.passwordHash) {
    await burnPasswordCheck(password); // equalise timing with the real check
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw accountLocked();

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailedPassword(user);
    throw invalid;
  }

  // Only revealed after the correct password has been supplied.
  if (user.status !== 'ACTIVE') throw Errors.forbidden('This account has been disabled.', 'ACCOUNT_DISABLED');
  if (!user.emailVerifiedAt) {
    throw Errors.forbidden('Please verify your email address before signing in.', 'EMAIL_NOT_VERIFIED');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const { session, refreshToken } = await createSession(user.id, meta);
  return { refreshToken, ...(await sessionResponse(session.id)) };
}

/**
 * Rotates the refresh token. A token whose secret no longer matches is a replayed copy
 * (the legitimate client already rotated it) — the session is revoked to cut off both parties.
 */
export async function refresh(rawToken) {
  const parsed = parseRefreshToken(rawToken);
  const expired = Errors.unauthenticated('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  if (!parsed) throw expired;

  const session = await prisma.session.findUnique({ where: { id: parsed.sessionId }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') throw expired;

  if (!safeEqual(sha256(parsed.secret), session.refreshTokenHash)) {
    // A stale token seconds after a rotation is almost always two tabs refreshing at once:
    // refuse it (the browser already holds the new cookie) but don't treat it as theft.
    const justRotated = Date.now() - session.lastUsedAt.getTime() < REUSE_GRACE_MS;
    if (!justRotated) await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    throw expired;
  }

  const { secret, hash } = newRefreshSecret();
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    data: { refreshTokenHash: hash, lastUsedAt: new Date() },
  });
  if (count !== 1) throw expired; // lost a concurrent rotation race

  return { refreshToken: `${session.id}.${secret}`, ...(await sessionResponse(session.id)) };
}

export async function logout(rawToken) {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) return;
  await prisma.session.updateMany({ where: { id: parsed.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

const revokeAllSessions = (db, userId, exceptSessionId) =>
  db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId && { NOT: { id: exceptSessionId } }) },
    data: { revokedAt: new Date() },
  });

// ─────────────────────────────── Password recovery ───────────────────────────────

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return; // generic response either way
  const token = await issueAuthToken(prisma, { userId: user.id, type: 'PASSWORD_RESET' });
  await sendPasswordResetEmail(user, token);
}

export async function resetPassword({ token: rawToken, password }) {
  const token = await findValidToken(rawToken, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await consumeToken(tx, token.id, 'PASSWORD_RESET');
    await tx.user.update({
      where: { id: token.userId },
      // Receiving the email proves ownership, so the address counts as verified too.
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, emailVerifiedAt: token.user.emailVerifiedAt ?? new Date() },
    });
    await revokeAllSessions(tx, token.userId); // sign out everywhere
  });
}

// ─────────────────────────────── Profile ───────────────────────────────

export async function buildMe(ctx) {
  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    include: { organization: { select: { id: true, name: true } }, role: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  return {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      firstName: ctx.user.firstName,
      lastName: ctx.user.lastName,
      name: fullName(ctx.user),
      isPlatformAdmin: ctx.user.isPlatformAdmin,
    },
    workspace: ctx.organizationId
      ? {
          membershipId: ctx.membershipId,
          organization: { id: ctx.organization.id, name: ctx.organization.name, slug: ctx.organization.slug },
          role: ctx.role,
          permissions: [...ctx.permissions].sort(),
          ...(await getEntitlementSummary(ctx.organizationId)),
        }
      : null,
    workspaceBlockedReason: ctx.tenantBlockedReason === 'NO_WORKSPACE' && !memberships.length ? 'NO_WORKSPACE' : ctx.tenantBlockedReason,
    memberships: memberships.map((m) => ({ id: m.id, organization: m.organization, roleName: m.role.name })),
  };
}

/** Changes the session's active workspace. The membership must belong to the caller. */
export async function switchSessionWorkspace(ctx, membershipId) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, userId: ctx.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
  });
  if (!membership) throw Errors.notFound('Workspace');
  await prisma.session.update({ where: { id: ctx.sessionId }, data: { membershipId } });
  return sessionResponse(ctx.sessionId);
}

export async function updateProfile(ctx, { firstName, lastName }) {
  await prisma.user.update({ where: { id: ctx.userId }, data: { firstName, lastName } });
  return buildMe(await loadSessionContext(ctx.sessionId));
}

export async function changePassword(ctx, { currentPassword, newPassword }) {
  if (!(await verifyPassword(currentPassword, ctx.user.passwordHash))) {
    throw Errors.validation([{ field: 'currentPassword', message: 'Current password is incorrect' }]);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await revokeAllSessions(tx, ctx.userId, ctx.sessionId); // keep this device signed in
  });
}

// ─────────────────────────────── Invitations ───────────────────────────────

const invitationNoLongerValid = () =>
  Errors.badRequest('This invitation is no longer valid. Ask your administrator to send a new one.', 'INVALID_TOKEN');

/** What the accept page shows. Only the holder of the emailed token can read it. */
export async function getInvitation(rawToken) {
  const token = await findValidToken(rawToken, 'INVITATION');
  if (token.membership?.status !== 'INVITED') throw invitationNoLongerValid();
  return {
    email: token.user.email,
    firstName: token.user.firstName,
    lastName: token.user.lastName,
    organizationName: token.membership.organization.name,
    roleName: token.membership.role.name,
    inviterName: token.membership.invitedBy ? fullName(token.membership.invitedBy.user) : null,
    expiresAt: token.expiresAt,
    requiresPassword: !token.user.passwordHash, // true → a new account is created on acceptance
  };
}

/**
 * Joins the invited person to the organization named in the invitation (never one chosen by the client).
 *  - New person: sets their name and password here. Following the emailed link proves they own the
 *    address, so the account is verified too.
 *  - Existing account: must prove it is theirs — either already signed in as that account, or by
 *    entering its current password. A link alone is not enough to attach an existing account.
 *  - Signed in as a different account: refused, so nobody can claim another person's invitation.
 * Token consumption and membership activation happen in one transaction and are both conditional,
 * so concurrent acceptances produce exactly one membership.
 */
export async function acceptInvitation({ token: rawToken, password, firstName, lastName }, ctx = null) {
  const token = await findValidToken(rawToken, 'INVITATION');
  const { user, membership } = token;
  if (membership?.status !== 'INVITED') throw invitationNoLongerValid();
  if (ctx && ctx.userId !== user.id) {
    throw Errors.forbidden(
      `This invitation was sent to ${user.email}. Sign out, then open the link again and sign in with that address.`,
      'INVITATION_WRONG_ACCOUNT',
    );
  }
  if (membership.organization.status !== 'ACTIVE') throw Errors.forbidden('This organization is suspended.', 'ORGANIZATION_SUSPENDED');
  if (user.status !== 'ACTIVE') throw Errors.forbidden('This account has been disabled.', 'ACCOUNT_DISABLED');

  const isNewAccount = !user.passwordHash;
  if (isNewAccount) {
    const check = passwordRule.safeParse(password);
    if (!check.success) {
      throw Errors.validation([{ field: 'password', message: password ? check.error.issues[0].message : 'Choose a password to create your account' }]);
    }
  } else if (!ctx) {
    if (!password) throw Errors.validation([{ field: 'password', message: 'Enter your TeamFlow password to accept' }]);
    if (user.lockedUntil && user.lockedUntil > new Date()) throw accountLocked();
    if (!(await verifyPassword(password, user.passwordHash))) {
      await recordFailedPassword(user);
      throw Errors.validation([{ field: 'password', message: 'Incorrect password' }]);
    }
  }

  const passwordHash = isNewAccount ? await hashPassword(password) : undefined;
  await prisma.$transaction(async (tx) => {
    await consumeToken(tx, token.id, 'INVITATION');
    const { count } = await tx.membership.updateMany({
      where: { id: membership.id, status: 'INVITED' },
      data: { status: 'ACTIVE', joinedAt: new Date() },
    });
    if (count !== 1) throw invitationNoLongerValid(); // revoked or accepted concurrently
    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(isNewAccount && { passwordHash, ...(firstName && { firstName }), ...(lastName && { lastName }) }),
      },
    });
    // A signed-in invitee lands in the workspace they just joined.
    if (ctx) await tx.session.update({ where: { id: ctx.sessionId }, data: { membershipId: membership.id } });
    await logActivity(tx, {
      organizationId: membership.organizationId,
      actorId: membership.id,
      action: ACTIONS.MEMBER_JOINED,
      entityType: 'MEMBER',
      entityId: membership.id,
      metadata: {},
    });
  });
  return { email: user.email, organizationName: membership.organization.name };
}
