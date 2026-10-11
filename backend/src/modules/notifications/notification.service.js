import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../common/errors/AppError.js';
import { paginate } from '../../common/utils/http.js';
import { CATEGORIES, TYPES, channelsFor } from './notification.catalog.js';
import { kickDelivery } from './notification.delivery.js';

/**
 * Records a notification for each recipient, inside the caller's transaction, so it exists only if the
 * business change commits. Email is queued in the same transaction (outbox) and sent after commit.
 *
 *   recipients — membership ids chosen by the server from the event (never from a client); the actor,
 *                duplicates, and members who are not active in `organizationId` are dropped
 *   dedupeKey  — same event + same person → one notification, however often the event is retried
 */
export async function notify(tx, { organizationId, recipients, actorId = null, type, title, message, link = null, entityType = null, entityId = null, dedupeKey = null }) {
  const def = TYPES[type];
  if (!def) throw new Error(`Unknown notification type ${type}`);
  const ids = [...new Set(recipients.filter((id) => id && id !== actorId))];
  if (!ids.length) return 0;

  const members = await tx.membership.findMany({
    where: { id: { in: ids }, organizationId, status: 'ACTIVE' },
    select: { id: true, notificationPrefs: { where: { category: def.category } } },
  });
  const rows = [];
  for (const m of members) {
    const ch = channelsFor(def.category, m.notificationPrefs[0]);
    const email = def.email === 'always' || (def.email === 'pref' && ch.email);
    if (!ch.inApp && !email) continue;
    rows.push({ organizationId, membershipId: m.id, type, title, message, link, entityType, entityId, dedupeKey, inApp: ch.inApp, email });
  }
  if (!rows.length) return 0;

  const created = await tx.notification.createManyAndReturn({
    data: rows.map(({ email: _email, ...r }) => r),
    skipDuplicates: true, // dedupeKey already used for this person
    select: { id: true, membershipId: true },
  });
  const emailFor = new Set(rows.filter((r) => r.email).map((r) => r.membershipId));
  const deliveries = created.filter((n) => emailFor.has(n.membershipId)).map((n) => ({ notificationId: n.id }));
  if (deliveries.length) {
    await tx.notificationDelivery.createMany({ data: deliveries });
    kickDelivery(); // soon after commit; the periodic sweep picks it up if the kick runs early
  }
  return created.length;
}

// ─────────────────────────── Recipients ───────────────────────────

/** Active members whose role holds `permission` (e.g. BILLING_MANAGE: the Owner by default). */
export async function membersWithPermission(db, organizationId, permission) {
  const members = await db.membership.findMany({
    where: { organizationId, status: 'ACTIVE', role: { permissions: { some: { permission: { key: permission } } } } },
    select: { id: true },
  });
  return members.map((m) => m.id);
}

/** Who answers for a project: its lead, else whoever created it. */
export const projectResponsible = (project) => project.leadId ?? project.createdById ?? null;

// ─────────────────────────── Reading (always the caller's own) ───────────────────────────

const mine = (ctx) => ({ organizationId: ctx.organizationId, membershipId: ctx.membershipId, inApp: true });

const present = (n) => ({
  id: n.id,
  type: n.type,
  category: TYPES[n.type]?.category ?? null,
  title: n.title,
  message: n.message,
  link: n.link,
  entityType: n.entityType,
  entityId: n.entityId,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

export async function listNotifications(ctx, query) {
  const { skip, take, meta } = paginate(query);
  const where = { ...mine(ctx), ...(query.unread && { readAt: null }) };
  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
  ]);
  return { items: items.map(present), meta: meta(total) };
}

export const unreadCount = async (ctx) => ({ count: await prisma.notification.count({ where: { ...mine(ctx), readAt: null } }) });

/** Someone else's id (or another workspace's) simply isn't found. */
export async function markRead(ctx, id) {
  const { count } = await prisma.notification.updateMany({ where: { id, ...mine(ctx), readAt: null }, data: { readAt: new Date() } });
  if (!count) {
    // Already read is fine; not found (or not theirs) is a 404.
    const exists = await prisma.notification.count({ where: { id, ...mine(ctx) } });
    if (!exists) throw Errors.notFound('Notification');
  }
  return unreadCount(ctx);
}

export async function markAllRead(ctx) {
  await prisma.notification.updateMany({ where: { ...mine(ctx), readAt: null }, data: { readAt: new Date() } });
  return unreadCount(ctx);
}

// ─────────────────────────── Preferences ───────────────────────────

export async function getPreferences(ctx) {
  const saved = await prisma.notificationPreference.findMany({ where: { membershipId: ctx.membershipId } });
  const byCategory = Object.fromEntries(saved.map((p) => [p.category, p]));
  return Object.entries(CATEGORIES).map(([key, def]) => ({
    category: key,
    label: def.label,
    locked: !!def.locked,
    ...channelsFor(key, byCategory[key]),
  }));
}

export async function updatePreferences(ctx, preferences) {
  for (const p of preferences) {
    if (!CATEGORIES[p.category]) throw Errors.validation([{ field: 'category', message: 'Unknown notification category' }]);
    if (CATEGORIES[p.category].locked) throw Errors.validation([{ field: p.category, message: 'Billing notifications are always on' }]);
  }
  await prisma.$transaction(
    preferences.map((p) =>
      prisma.notificationPreference.upsert({
        where: { membershipId_category: { membershipId: ctx.membershipId, category: p.category } },
        update: { inApp: p.inApp, email: p.email },
        create: { membershipId: ctx.membershipId, category: p.category, inApp: p.inApp, email: p.email },
      }),
    ),
  );
  return getPreferences(ctx);
}
