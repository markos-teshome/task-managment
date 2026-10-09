import { Skeleton } from '../ui/Misc.jsx';
import { LogoMark } from '../brand/Logo.jsx';

/** Skeleton for a page that is still loading: header + a few rows, matching real layout. */
export function PageLoader() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-3.5 w-72 max-w-full" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Full-screen splash while the session is restored on first load. */
export function SplashScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas" aria-busy="true" aria-label="Loading TeamFlow">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  );
}
