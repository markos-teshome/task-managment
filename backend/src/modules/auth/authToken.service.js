import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { randomToken, sha256 } from '../../common/utils/crypto.js';

const TTL_MS = {
  EMAIL_VERIFICATION: 24 * 3_600_000,
  PASSWORD_RESET: 3_600_000,
  INVITATION: 7 * 24 * 3_600_000,
};

/**
 * Issues a single-use token. Previous unused tokens of the same type (and invitation) are
 * removed, so only the most recent link works. Returns the raw token for the email — it is
 * never stored or logged.
 */
export async function issueAuthToken(db, { userId, type, membershipId = null }) {
  await db.authToken.deleteMany({ where: { userId, type, usedAt: null, ...(membershipId && { membershipId }) } });
  const raw = randomToken(32);
  await db.authToken.create({
    data: { userId, type, membershipId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL_MS[type]) },
  });
  return raw;
}

const INVALID = {
  EMAIL_VERIFICATION: 'This verification link is invalid or has expired. Request a new one.',
  PASSWORD_RESET: 'This password reset link is invalid or has expired. Request a new one.',
  INVITATION: 'This invitation is invalid or has expired. Ask your administrator to resend it.',
};

/** Finds a valid (unused, unexpired) token without consuming it. */
export async function findValidToken(raw, type, db = prisma) {
  const token = await db.authToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true, membership: { include: { organization: true, role: true } } },
  });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
    throw Errors.badRequest(INVALID[type], 'INVALID_TOKEN');
  }
  return token;
}

/**
 * Marks a token used. The conditional update makes consumption atomic: if two requests race
 * with the same token, only one succeeds.
 */
export async function consumeToken(tx, tokenId, type) {
  const { count } = await tx.authToken.updateMany({ where: { id: tokenId, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) throw Errors.badRequest(INVALID[type], 'INVALID_TOKEN');
}
