import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { randomToken, sha256 } from '../../common/utils/crypto.js';

const TTL_MS = {
  EMAIL_VERIFICATION: 24 * 3_600_000,
  PASSWORD_RESET: 30 * 60_000,
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
  INVITATION:
    'This invitation link is not valid. It may have been withdrawn or replaced by a newer invitation. Ask your administrator to send a new one.',
};

/**
 * Invitation links get specific answers for "expired" and "already accepted": only the holder of the
 * 256-bit token sees them, so they reveal nothing to anyone guessing. Withdrawn invitations (their
 * token is deleted with them), replaced and unknown links all get the same generic INVALID_TOKEN.
 */
const INVITATION_STATE = {
  used: ['INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted. Sign in to continue.'],
  expired: ['INVITATION_EXPIRED', 'This invitation has expired. Ask your administrator to send a new one.'],
};

/** Finds a valid (unused, unexpired) token without consuming it. */
export async function findValidToken(raw, type, db = prisma) {
  const token = await db.authToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: {
      user: true,
      membership: { include: { organization: true, role: true, invitedBy: { include: { user: true } } } },
    },
  });
  if (!token || token.type !== type) throw Errors.badRequest(INVALID[type], 'INVALID_TOKEN');
  const state = token.usedAt ? 'used' : token.expiresAt < new Date() ? 'expired' : null;
  if (state) {
    if (type === 'INVITATION') throw Errors.badRequest(INVITATION_STATE[state][1], INVITATION_STATE[state][0]);
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
