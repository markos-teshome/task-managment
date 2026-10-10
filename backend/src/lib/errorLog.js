/**
 * Recent unexpected server errors, kept in memory for the platform health view.
 * Only operational facts are kept (when, which route, error type, request id) — never messages,
 * request bodies or user data, which could contain tenant information or secrets.
 * Per process and cleared on restart; full details stay in the server log.
 */
const MAX = 50;
const recent = [];
let total = 0;
const startedAt = new Date();

export function recordInternalError({ method, route, name, requestId }) {
  total += 1;
  recent.unshift({ at: new Date(), method, route, type: name ?? 'Error', requestId: requestId ?? null });
  if (recent.length > MAX) recent.pop();
}

export const internalErrorSummary = () => ({ since: startedAt, total, recent: [...recent] });
