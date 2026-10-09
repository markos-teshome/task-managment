import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, session } from '../../lib/api.js';

const AuthContext = createContext(null);

// Non-secret hint that this browser has signed in before, so anonymous visitors don't fire a
// refresh request that is certain to fail. The real credential stays in the httpOnly cookie.
const HINT_KEY = 'tf.hasSession';
const hint = {
  get: () => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return true;
    }
  },
  set: (on) => {
    try {
      localStorage.setItem(HINT_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable: always try to restore the session */
    }
  },
};

/**
 * Session state for the SPA.
 * The access token lives only in memory (lib/api.js). On page load the httpOnly refresh cookie
 * is exchanged for a new access token, so a reload keeps you signed in without the token ever
 * touching localStorage.
 *
 * `me` mirrors GET /auth/me: user, active workspace (role, permissions, plan, usage) and memberships.
 * Permission helpers here only drive the UI — the API enforces every rule independently.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', me: null, notice: null });

  const applySession = useCallback(
    ({ accessToken, me }) => {
      session.setToken(accessToken);
      hint.set(true);
      queryClient.clear(); // never show one workspace's cached data in another
      setState({ status: 'authenticated', me, notice: null });
      return me;
    },
    [queryClient],
  );

  const endSession = useCallback(
    (notice = null) => {
      session.clear();
      hint.set(false);
      queryClient.clear();
      setState({ status: 'anonymous', me: null, notice });
    },
    [queryClient],
  );

  const reloadMe = useCallback(async () => {
    const me = await api.get('/auth/me');
    setState((s) => ({ ...s, me }));
    return me;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!hint.get()) {
      setState({ status: 'anonymous', me: null, notice: null });
      return undefined;
    }
    const boot = async () => {
      try {
        return await refreshSession();
      } catch (err) {
        // Another tab may have rotated the cookie at the same moment — try once more.
        if (err.status === 401) {
          await new Promise((r) => setTimeout(r, 400));
          return refreshSession();
        }
        throw err;
      }
    };
    boot()
      .then((data) => !cancelled && applySession(data))
      .catch(() => {
        if (cancelled) return;
        hint.set(false);
        setState({ status: 'anonymous', me: null, notice: null });
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    session.on('sessionExpired', () => endSession('expired'));
    session.on('workspaceBlocked', () => reloadMe().catch(() => {}));
  }, [endSession, reloadMe]);

  const value = useMemo(() => {
    const permissions = new Set(state.me?.workspace?.permissions ?? []);
    return {
      ...state,
      user: state.me?.user ?? null,
      workspace: state.me?.workspace ?? null,
      can: (...perms) => perms.every((p) => permissions.has(p)),
      canAny: (...perms) => perms.some((p) => permissions.has(p)),
      hasFeature: (f) => !!state.me?.workspace?.plan.features.includes(f),
      signIn: async (credentials) => applySession(await api.post('/auth/login', credentials)),
      signOut: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          endSession();
        }
      },
      applySession,
      reloadMe,
    };
  }, [state, applySession, endSession, reloadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
