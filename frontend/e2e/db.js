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
