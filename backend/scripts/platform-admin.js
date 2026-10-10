/**
 * Grants or revokes TeamFlow platform-admin (super admin) rights. This is the only way to do it:
 * there is no API for it, and organization registration never grants it.
 *
 *   npm run platform-admin -- grant  person@company.com
 *   npm run platform-admin -- revoke person@company.com
 *   npm run platform-admin -- list
 *
 * The account must already exist with a verified email address. Changes are written to the
 * platform audit log (actor = command line).
 */
import { prisma } from '../src/lib/prisma.js';
import { PLATFORM_ACTIONS, recordPlatformAction } from '../src/modules/platform/platform.service.js';

const [command, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

async function main() {
  if (command === 'list') {
    const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true, status: true }, orderBy: { email: 'asc' } });
    console.log(admins.length ? admins.map((a) => `${a.email} (${a.status})`).join('\n') : 'No platform admins.');
    return;
  }
  if (!['grant', 'revoke'].includes(command) || !email) {
    throw new Error('Usage: npm run platform-admin -- grant|revoke <email>  |  npm run platform-admin -- list');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with the email ${email}. The person must register first.`);
  if (command === 'grant' && (!user.emailVerifiedAt || user.status !== 'ACTIVE')) {
    throw new Error(`${email} must be an active account with a verified email address.`);
  }

  const grant = command === 'grant';
  if (user.isPlatformAdmin === grant) {
    console.log(`${email} ${grant ? 'is already' : 'is not'} a platform admin. Nothing changed.`);
    return;
  }
  if (!grant && (await prisma.user.count({ where: { isPlatformAdmin: true } })) === 1) {
    throw new Error('Refusing to revoke the last platform admin.');
  }

  await prisma.$transaction(async (tx) => {
    // Rights are re-read from the database on every request, so a revocation applies immediately.
    await tx.user.update({ where: { id: user.id }, data: { isPlatformAdmin: grant } });
    await recordPlatformAction(tx, {
      actorId: null,
      action: grant ? PLATFORM_ACTIONS.PLATFORM_ADMIN_GRANTED : PLATFORM_ACTIONS.PLATFORM_ADMIN_REVOKED,
      targetType: 'USER',
      targetId: user.id,
      metadata: { email, via: 'command line' },
    });
  });
  console.log(`${email} ${grant ? 'is now' : 'is no longer'} a platform admin.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
