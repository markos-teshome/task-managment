import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { sendMail } from '../../lib/mailer.js';
import { compose } from '../../lib/emailLayout.js';
import { config } from '../../config/env.js';
import { TYPES } from './notification.catalog.js';

/**
 * Email side of notifications (transactional outbox). Rows are written with the business change; this
 * worker claims due rows with SKIP LOCKED (so two API instances never send the same email), sends them,
 * and records the result. Temporary failures are retried with backoff; a row is only SENT when the SMTP
 * server accepted the message.
 */
const BATCH = 20;
const MAX_ATTEMPTS = 4;
const CLAIM_MINUTES = 10; // a claimed row whose worker died becomes due again after this
const backoffMinutes = (attempt) => [1, 5, 30][attempt - 1] ?? 30;

const ACTION_LABEL = { TASK: 'Open task', PROJECT: 'Open project', SUBSCRIPTION: 'Open plan & billing', PAYMENT: 'Open plan & billing', MEMBER: 'Open team' };

function render(n, user, organizationName) {
  const billing = TYPES[n.type]?.category === 'BILLING';
  return {
    subject: n.title,
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: [n.message, `Workspace: ${organizationName}`],
      action: ACTION_LABEL[n.entityType] ?? 'Open TeamFlow',
      url: `${config.APP_URL}${n.link ?? '/'}`,
      footnote: billing
        ? 'You receive billing emails because you manage billing for this organization.'
        : 'Choose which emails you get in TeamFlow under Settings → Notifications.',
    }),
  };
}

// Columns are UTC timestamps without time zone (Prisma's convention), so compare against UTC "now",
// whatever the database session's time zone is.
async function claim() {
  return prisma.$queryRaw`
    UPDATE notification_deliveries SET status = 'SENDING', attempts = attempts + 1,
           "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${CLAIM_MINUTES}::int)
     WHERE id IN (SELECT id FROM notification_deliveries
                   WHERE status IN ('PENDING', 'SENDING') AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
                   ORDER BY "createdAt" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
    RETURNING id, "notificationId", attempts`;
}

async function deliver(row) {
  const n = await prisma.notification.findUnique({
    where: { id: row.notificationId },
    include: { membership: { select: { status: true, user: { select: { email: true, firstName: true, status: true } } } }, organization: { select: { name: true, status: true } } },
  });
  // Still a member, still an active account and organization? Otherwise don't email.
  if (!n || n.membership.status !== 'ACTIVE' || n.membership.user.status !== 'ACTIVE' || n.organization.status !== 'ACTIVE') {
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'Recipient no longer active' } });
    return;
  }
  const accepted = await sendMail({ to: n.membership.user.email, template: `notification:${n.type}`, ...render(n, n.membership.user, n.organization.name) });
  if (accepted) {
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
  } else {
    const final = row.attempts >= MAX_ATTEMPTS;
    await prisma.notificationDelivery.update({
      where: { id: row.id },
      data: final
        ? { status: 'FAILED', lastError: 'SMTP did not accept the message' }
        : { status: 'PENDING', lastError: 'SMTP did not accept the message', nextAttemptAt: new Date(Date.now() + backoffMinutes(row.attempts) * 60_000) },
    });
  }
}

let running = null;

/** Sends everything that is due. Concurrent calls in one process share the same run. */
export function processDeliveries() {
  running ??= (async () => {
    try {
      for (let rows = await claim(); rows.length; rows = await claim()) {
        for (const row of rows) await deliver(row).catch((err) => logger.error({ err: err.message, delivery: row.id }, 'Notification email failed'));
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Asks for a delivery run shortly (after the caller's transaction has committed). No-op in tests. */
export function kickDelivery() {
  if (config.isTest) return;
  setTimeout(() => processDeliveries().catch((err) => logger.error({ err: err.message }, 'Notification delivery run failed')), 1500).unref();
}
