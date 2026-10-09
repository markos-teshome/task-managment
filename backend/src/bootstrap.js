import { prisma } from './lib/prisma.js';
import { PERMISSION_CATALOG } from './common/constants/permissions.js';
import { DEFAULT_PLANS } from './common/constants/plans.js';

/**
 * Reference data the application cannot run without. Runs on every startup and in the seed,
 * so a fresh database works after `prisma migrate deploy` with no manual inserts.
 *  - Permissions are upserted from code (code is the source of truth).
 *  - Default plans are only created when missing; existing plans are owned by the platform
 *    admin and are never overwritten.
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
}
