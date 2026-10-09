/**
 * Display formatting. Task/project dates are calendar dates sent as UTC midnight,
 * so they are read with UTC getters to avoid shifting a day in negative-offset time zones.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const localTodayKey = () => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

const calendarKey = (iso) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** "Oct 12" (or "Oct 12, 2027" outside the current year) for calendar dates. */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${sameYear ? '' : `, ${d.getUTCFullYear()}`}`;
}

/** Long form for timestamps: "Oct 12, 2026". */
export function formatLongDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Due-date label + tone. Completed work is never "overdue".
 * tone: overdue | today | soon | normal | none
 */
export function dueInfo(iso, { completed = false } = {}) {
  if (!iso) return { label: 'No date', tone: 'none' };
  const diff = Math.round((calendarKey(iso) - localTodayKey()) / DAY_MS);
  if (completed) return { label: formatDate(iso), tone: 'normal' };
  if (diff < 0) return { label: diff === -1 ? 'Yesterday' : formatDate(iso), tone: 'overdue', days: -diff };
  if (diff === 0) return { label: 'Today', tone: 'today' };
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon' };
  if (diff < 7) return { label: new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), tone: 'soon' };
  return { label: formatDate(iso), tone: 'normal' };
}

/** "just now", "5m ago", "3h ago", "Yesterday", "Oct 3" — for activity timestamps. */
export function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY_MS && new Date(iso).getDate() === new Date().getDate()) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = new Date(iso);
  const yesterday = new Date(Date.now() - DAY_MS);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Heading for grouping a timeline by day. */
export function dayHeading(iso) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - DAY_MS).toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** ISO calendar date → value for <input type="date">. */
export const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export function formatMoney(cents, currency = 'ETB') {
  const amount = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${currency} ${amount}`;
}

export const formatLimit = (value) => (value === null || value === undefined ? 'Unlimited' : value.toLocaleString('en-US'));

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const pluralize = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
