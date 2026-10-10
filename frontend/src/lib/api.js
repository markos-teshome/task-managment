/**
 * The only module that talks HTTP. Responsibilities:
 *  - base URL and JSON handling;
 *  - attaching the in-memory access token;
 *  - silently refreshing an expired token once (single-flight) and retrying;
 *  - turning every failure into an ApiError with a human-readable message.
 * Feature `api.js` files call `api.get/post/...` — no component calls fetch directly.
 */
const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

let accessToken = null;
let workspaceId = null; // membership id of the workspace this tab is showing
const listeners = { sessionExpired: () => {}, workspaceBlocked: () => {}, workspaceChanged: () => {} };

export const session = {
  setToken: (t) => {
    accessToken = t;
  },
  /** Sent as X-Workspace-Id: the API answers 409 instead of serving another workspace's data. */
  setWorkspace: (id) => {
    workspaceId = id ?? null;
  },
  clear: () => {
    accessToken = null;
    workspaceId = null;
  },
  on: (event, fn) => {
    listeners[event] = fn;
  },
};

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field errors from a 422, keyed by field name, for forms. */
  get fieldErrors() {
    return Object.fromEntries((this.details ?? []).map((d) => [d.field, d.message]));
  }
}

const FALLBACK_MESSAGES = {
  0: "We couldn't reach TeamFlow. Check your connection and try again.",
  500: 'Something went wrong on our side. Please try again.',
};

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout'];
const BLOCKING_CODES = ['MEMBERSHIP_INACTIVE', 'ORGANIZATION_SUSPENDED', 'NO_WORKSPACE'];

function buildUrl(path, query) {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

let refreshing = null;

/** Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshing ??= send('/auth/refresh', { method: 'POST', retry: false })
    .then((data) => {
      accessToken = data.accessToken;
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(path, { method = 'GET', body, query, signal, retry = true, withMeta = false, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: FALLBACK_MESSAGES[0] });
  }

  if (res.status === 401 && retry && accessToken && !NO_REFRESH.includes(path)) {
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      listeners.sessionExpired();
      throw new ApiError({ status: 401, code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' });
    }
    return send(path, { method, body, query, signal, retry: false, withMeta, raw });
  }

  if (raw && res.ok) return res;

  const payload = await res.json().catch(() => null);
  // TeamFlow's own errors always carry a JSON envelope. A 5xx without one comes from a proxy or
  // gateway in front of the API (Vite answers 500, nginx 502/504) — i.e. the API is unreachable.
  if (!payload && res.status >= 500) {
    throw new ApiError({ status: res.status, code: 'SERVICE_UNAVAILABLE', message: 'TeamFlow is temporarily unavailable. Please try again in a moment.' });
  }
  if (!res.ok || !payload?.success) {
    const error = payload?.error ?? {};
    const apiError = new ApiError({
      status: res.status,
      code: error.code ?? 'UNKNOWN',
      message: error.message ?? FALLBACK_MESSAGES[500],
      details: error.details,
    });
    if (res.status === 403 && BLOCKING_CODES.includes(apiError.code)) listeners.workspaceBlocked(apiError);
    if (apiError.code === 'WORKSPACE_CHANGED') listeners.workspaceChanged(apiError);
    throw apiError;
  }
  return withMeta ? { items: payload.data, meta: payload.meta } : payload.data;
}

export const api = {
  get: (path, opts) => send(path, opts),
  /** For paginated lists: resolves to { items, meta }. */
  list: (path, query, opts) => send(path, { ...opts, query, withMeta: true }),
  post: (path, body, opts) => send(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => send(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => send(path, { ...opts, method: 'DELETE' }),
  download: (path, query) => send(path, { query, raw: true }),
};

/** Plan-limit / plan-feature errors get dedicated UI instead of a generic message. */
export const isPlanLimitError = (err) =>
  err instanceof ApiError && ['SUBSCRIPTION_USER_LIMIT', 'SUBSCRIPTION_PROJECT_LIMIT', 'PLAN_FEATURE_UNAVAILABLE'].includes(err.code);
