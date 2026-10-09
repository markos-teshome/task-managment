import { AlertTriangle, Lock, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { Link } from 'react-router';
import { Button, ButtonLink } from '../ui/Button.jsx';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { cn } from '../../lib/cn.js';

/** Lightweight empty state: what's missing, why it matters, one action. */
export function EmptyState({ icon: Icon, title, description, action, compact = false, className }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      {Icon && (
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon size={18} aria-hidden="true" />
        </span>
      )}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Error with a plain-language message and a retry. Never shows raw technical details. */
export function ErrorState({ error, onRetry, title, compact = false, className }) {
  const offline = error?.code === 'NETWORK_ERROR';
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <Icon size={18} aria-hidden="true" />
      </span>
      <p className="text-[14px] font-semibold">{title ?? (offline ? "You're offline" : "We couldn't load this")}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
        {offline ? 'Check your internet connection, then try again.' : (error?.message ?? 'Something went wrong. Please try again.')}
      </p>
      {onRetry && (
        <Button className="mt-4" size="sm" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Shown for pages the current role cannot use (e.g. an employee typing /billing). */
export function AccessDenied({ message }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-ink-muted">
        <Lock size={18} aria-hidden="true" />
      </span>
      <h1 className="text-base font-semibold">You don't have access to this page</h1>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
        {message ?? 'Your role in this organization does not include this area. If you need it, ask an owner or admin.'}
      </p>
      <ButtonLink to="/" variant="secondary" size="sm" className="mt-4">
        Back to dashboard
      </ButtonLink>
    </div>
  );
}

const LIMIT_TITLES = {
  SUBSCRIPTION_USER_LIMIT: 'Team member limit reached',
  SUBSCRIPTION_PROJECT_LIMIT: 'Project limit reached',
  PLAN_FEATURE_UNAVAILABLE: 'Not included in your plan',
};

/**
 * Explains a subscription rule instead of showing a bare error. Owners (who can manage the
 * subscription) get a direct path to the plans; everyone else is told whom to ask.
 */
export function PlanLimitNotice({ code, message, className }) {
  const { can } = useAuth();
  const canUpgrade = can('SUBSCRIPTION_MANAGE', 'BILLING_MANAGE');
  return (
    <div role="alert" className={cn('rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5', className)}>
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-accent-700" aria-hidden="true" />
        <div className="min-w-0 text-[13px]">
          <p className="font-semibold text-ink">{LIMIT_TITLES[code] ?? 'Plan limit reached'}</p>
          <p className="mt-0.5 text-ink-muted">{message}</p>
          {canUpgrade ? (
            <Link to="/billing#plans" className="mt-1.5 inline-flex font-medium text-brand-700 underline-offset-2 hover:underline">
              View plans →
            </Link>
          ) : (
            <p className="mt-1 text-ink-muted">Ask your organization owner to upgrade the plan.</p>
          )}
        </div>
      </div>
    </div>
  );
}
