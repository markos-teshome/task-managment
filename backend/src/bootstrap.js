import { prisma } from './lib/prisma.js';
import { ALL_PERMISSION_KEYS, OWNER_ROLE_KEY, PERMISSION_CATALOG } from './common/constants/permissions.js';
import { DEFAULT_PLANS } from './common/constants/plans.js';

/**
 * Reference data the application cannot run without. Runs on every startup and in the seed,
 * so a fresh database works after `prisma migrate deploy` with no manual inserts.
 *  - Permissions are upserted from code (code is the source of truth).
 *  - Default plans are only created when missing; existing plans are owned by the platform
 *    admin and are never overwritten.
 *  - Owner roles always hold every permission (the role is locked), including ones added later.
 *    Other roles are never changed here: organizations may have edited them.
 */
export async function ensureReferenceData(db = prisma) {
  for (const p of PERMISSION_CATALOG) {
    await db.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: { key: p.key, group: p.group, description: p.description },
    });
  }

  for (const plan of DEFAULT_PLANS) {
    await db.subscriptionPlan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  }

  // One statement: grant any permission an Owner role is missing.
  await db.$executeRaw`
    INSERT INTO "role_permissions" ("roleId", "permissionId")
    SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
    WHERE r."key" = ${OWNER_ROLE_KEY} AND p."key" = ANY(${ALL_PERMISSION_KEYS})
    ON CONFLICT DO NOTHING`;
}
