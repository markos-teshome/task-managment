import { Link } from 'react-router';
import { Logo } from '../../components/brand/Logo.jsx';

/** Minimal, centred layout for sign-in and account flows. A thin yellow rule is the only decoration. */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="h-1 bg-brand-800">
        <div className="h-full w-24 bg-accent-500" />
      </div>
      <main className="flex flex-1 flex-col items-center px-4 pb-10 pt-10 sm:pt-16">
        <Link to="/" className="mb-8">
          <Logo />
        </Link>
        <div className="w-full max-w-[400px]">
          <div className="rounded-xl border border-line bg-surface px-5 py-6 shadow-sm sm:px-7 sm:py-7">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
          {footer && <div className="mt-4 text-center text-[13px] text-ink-muted">{footer}</div>}
        </div>
      </main>
      <footer className="pb-6 text-center text-xs text-ink-subtle">© {new Date().getFullYear()} Teamwork IT Solution PLC</footer>
    </div>
  );
}
