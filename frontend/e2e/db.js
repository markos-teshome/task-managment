import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * Direct access to the isolated e2e TEST database (never the development database).
 * The API keeps emails in memory during e2e runs, so tests issue email links the same way the API does:
 * a random token whose SHA-256 is stored. The email link format itself is covered by backend tests.
 */
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
export const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
export const bcrypt = require('../../backend/node_modules/bcryptjs');

const PATHS = { EMAIL_VERIFICATION: '/verify-email', PASSWORD_RESET: '/reset-password', INVITATION: '/accept-invite' };

/** Issues a fresh single-use link for `email` (and, for invitations, its pending membership in `organizationSlug`). */
export async function emailLink(type, email, organizationSlug) {
  const user = await prisma.user.findUnique({ where: { email } });
  const membership =
    type === 'INVITATION'
      ? await prisma.membership.findFirst({ where: { status: 'INVITED', userId: user.id, organization: { slug: organizationSlug } } })
      : null;
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.authToken.deleteMany({ where: { userId: user.id, type, usedAt: null, ...(membership && { membershipId: membership.id }) } });
  await prisma.authToken.create({
    data: {
      userId: user.id,
      membershipId: membership?.id ?? null,
      type,
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return `${PATHS[type]}?token=${raw}`;
}

/** Platform sign-in sends a 6-digit code by email; tests replace the latest challenge's code with a known one. */
export async function knownPlatformCode(email, code = '246810') {
  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  const challenge = await prisma.platformLoginChallenge.findFirst({ where: { adminId: admin.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
  await prisma.platformLoginChallenge.update({
    where: { id: challenge.id },
    data: { codeHash: crypto.createHash('sha256').update(`${challenge.id}:${code}`).digest('hex') },
  });
  return code;
}

/** Platform admin reset link, issued the same way the API does (random token, only its SHA-256 stored, 15 minutes). */
export async function platformResetLink(email) {
  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.platformPasswordReset.deleteMany({ where: { adminId: admin.id, usedAt: null } });
  await prisma.platformPasswordReset.create({
    data: { adminId: admin.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return `/platform/reset-password?token=${raw}`;
}
