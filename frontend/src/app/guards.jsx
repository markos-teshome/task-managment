import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useAuth } from '../features/auth/AuthProvider.jsx';
import { SplashScreen } from '../components/feedback/PageLoader.jsx';
import { AccessDenied } from '../components/feedback/States.jsx';

/** Signed-in users only; others go to sign-in and come back afterwards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'anonymous') {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/**
 * Sign-in/sign-up screens are skipped when already signed in. This is also the single place that
 * decides where a fresh sign-in lands: the page they originally asked for (?next=), else home.
 */
export function GuestOnly() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'authenticated') {
    const next = params.get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    return <Navigate to={safe} replace />;
  }
  return <Outlet />;
}

/** Tenant pages need an active workspace. (Platform admins use their own sign-in at /platform/login.) */
export function RequireWorkspace() {
  const { workspace } = useAuth();
  if (workspace) return <Outlet />;
  return <Navigate to="/onboarding" replace />;
}

/** Page-level permission gate (UX only — every API call is authorised by the server). */
export function RequirePermission({ any, children }) {
  const { canAny } = useAuth();
  return canAny(...any) ? children : <AccessDenied />;
}

export function OnboardingGate({ children }) {
  const { workspace } = useAuth();
  return workspace ? <Navigate to="/" replace /> : children;
}
