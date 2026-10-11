/**
 * What TeamFlow notifies people about, and how members may tune it.
 *
 * Categories are what a member controls in Settings → Notifications. Each type belongs to one category and
 * says whether it may be emailed:
 *   email: 'pref'   — emailed when the member's category preference allows it
 *   email: 'never'  — in-app only (minor news)
 *   email: 'always' — always emailed (billing-critical); its category can't be turned off
 * Security emails (password changed) are not notifications: they are sent directly to the account owner,
 * whatever the preferences (see auth.emails.js).
 */
export const CATEGORIES = {
  TASK_ASSIGNMENTS: { label: 'Task assignments', inApp: true, email: true },
  TASK_REMINDERS: { label: 'Due date reminders', inApp: true, email: true },
  TASK_COMPLETED: { label: 'Task completed', inApp: true, email: false },
  PROJECT_UPDATES: { label: 'Project updates', inApp: true, email: false },
  TEAM: { label: 'Team updates', inApp: true, email: false },
  BILLING: { label: 'Billing and subscription', inApp: true, email: true, locked: true },
};

export const TYPES = {
  TASK_ASSIGNED: { category: 'TASK_ASSIGNMENTS', email: 'pref' },
  TASK_UNASSIGNED: { category: 'TASK_ASSIGNMENTS', email: 'never' },
  TASK_DUE_SOON: { category: 'TASK_REMINDERS', email: 'pref' },
  TASK_OVERDUE: { category: 'TASK_REMINDERS', email: 'pref' },
  TASK_COMPLETED: { category: 'TASK_COMPLETED', email: 'pref' },
  PROJECT_MEMBER_ADDED: { category: 'PROJECT_UPDATES', email: 'pref' },
  PROJECT_MEMBER_REMOVED: { category: 'PROJECT_UPDATES', email: 'pref' },
  PROJECT_LEAD_ASSIGNED: { category: 'PROJECT_UPDATES', email: 'pref' },
  PROJECT_DUE_SOON: { category: 'PROJECT_UPDATES', email: 'pref' },
  PROJECT_COMPLETED: { category: 'PROJECT_UPDATES', email: 'never' },
  INVITATION_ACCEPTED: { category: 'TEAM', email: 'pref' },
  SUBSCRIPTION_EXPIRING: { category: 'BILLING', email: 'always' },
  SUBSCRIPTION_EXPIRED: { category: 'BILLING', email: 'always' },
  PAYMENT_SUCCEEDED: { category: 'BILLING', email: 'always' },
  PAYMENT_FAILED: { category: 'BILLING', email: 'always' },
};

/** Channels for one member and category: their saved choice, else the default (locked categories: always on). */
export function channelsFor(category, saved) {
  const def = CATEGORIES[category];
  if (def.locked || !saved) return { inApp: def.inApp, email: def.email };
  return { inApp: saved.inApp, email: saved.email };
}
