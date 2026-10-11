/**
 * TeamFlow platform administrators (super admins) are managed only here — never through public
 * registration or any API. Requires server/database access; every change is written to the platform
 * audit log (actor = command line).
 *
 *   PLATFORM_ADMIN_PASSWORD='…' npm run platform-admin -- create <email> <first name> <last name>
 *   PLATFORM_ADMIN_PASSWORD='…' npm run platform-admin -- reset-password <email>
 *   npm run platform-admin -- disable <email>      (signs them out everywhere)
 *   npm run platform-admin -- enable <email>
 *   npm run platform-admin -- list
 *
 * The password comes from the environment, not the command line, so it never lands in shell history.
 * It must be at least 12 characters with letters and numbers. Sign-in also needs the emailed code, so
 * the email must be a real mailbox.
 */
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/common/utils/crypto.js';
import { platformPassword } from '../src/common/validators/index.js';
import { PLATFORM_ACTIONS, recordPlatformAction } from '../src/modules/platform/platform.service.js';

const [command, rawEmail, firstName, lastName] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const audit = (tx, action, admin) =>
  recordPlatformAction(tx, { actorId: null, action, targetType: 'PLATFORM_ADMIN', targetId: admin.id, metadata: { email: admin.email, via: 'command line' } });

function passwordFromEnv() {
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
  if (!platformPassword.safeParse(password).success) {
    throw new Error('Set PLATFORM_ADMIN_PASSWORD (at least 12 characters, with letters and numbers).');
  }
  return password;
}

async function findAdmin() {
  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!admin) throw new Error(`No platform admin with the email ${email}.`);
  return admin;
}

const commands = {
  async list() {
    const admins = await prisma.platformAdmin.findMany({ select: { email: true, status: true, lastLoginAt: true }, orderBy: { email: 'asc' } });
    console.log(admins.length ? admins.map((a) => `${a.email}  ${a.status}  last sign-in: ${a.lastLoginAt?.toISOString() ?? 'never'}`).join('\n') : 'No platform admins.');
  },
  async create() {
    if (!email || !firstName || !lastName) throw new Error('Usage: create <email> <first name> <last name>');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (await prisma.platformAdmin.findUnique({ where: { email } })) throw new Error(`${email} is already a platform admin.`);
    const passwordHash = await hashPassword(passwordFromEnv());
    await prisma.$transaction(async (tx) => {
      const admin = await tx.platformAdmin.create({ data: { email, firstName, lastName, passwordHash } });
      await audit(tx, PLATFORM_ACTIONS.PLATFORM_ADMIN_CREATED, admin);
    });
    console.log(`Platform admin ${email} created. Sign in at /platform/login (a code will be emailed).`);
  },
  async 'reset-password'() {
    const admin = await findAdmin();
    const passwordHash = await hashPassword(passwordFromEnv());
    await prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } });
      await tx.platformSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, PLATFORM_ACTIONS.PLATFORM_ADMIN_PASSWORD_RESET, admin);
    });
    console.log(`Password reset for ${email}; existing sessions were signed out.`);
  },
  async disable() {
    const admin = await findAdmin();
    if (admin.status === 'DISABLED') return console.log(`${email} is already disabled.`);
    if ((await prisma.platformAdmin.count({ where: { status: 'ACTIVE' } })) === 1) throw new Error('Refusing to disable the last active platform admin.');
    await prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
      await tx.platformSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, PLATFORM_ACTIONS.PLATFORM_ADMIN_DISABLED, admin);
    });
    console.log(`${email} is disabled and signed out.`);
  },
  async enable() {
    const admin = await findAdmin();
    if (admin.status === 'ACTIVE') return console.log(`${email} is already active.`);
    await prisma.$transaction(async (tx) => {
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { status: 'ACTIVE' } });
      await audit(tx, PLATFORM_ACTIONS.PLATFORM_ADMIN_ENABLED, admin);
    });
    console.log(`${email} is active again.`);
  },
};

const run = commands[command];
(run ? run() : Promise.reject(new Error('Usage: platform-admin create|reset-password|disable|enable|list …')))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
