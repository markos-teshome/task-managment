import { cn } from '../../lib/cn.js';

/** Thin progress bar with the value as text, so it is readable without colour. */
export function Progress({ value = 0, label, showValue = true, tone = 'brand', className }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const fill = { brand: 'bg-brand-600', accent: 'bg-accent-500', success: 'bg-success-600', danger: 'bg-danger-600', warning: 'bg-warning-600' }[tone];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', fill)} style={{ width: `${pct}%` }} />
      </div>
      {showValue && <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink-muted">{pct}%</span>}
    </div>
  );
}

/** "used / limit" meter for plan usage; turns warning near the limit, danger at the limit. */
export function UsageMeter({ label, used, limit, className }) {
  const unlimited = limit === null || limit === undefined;
  const ratio = unlimited ? 0 : used / Math.max(limit, 1);
  const tone = unlimited ? 'brand' : ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'brand';
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="text-[13px] font-medium tabular-nums">
          {used}
          <span className="font-normal text-ink-subtle"> / {unlimited ? 'Unlimited' : limit}</span>
        </span>
      </div>
      {!unlimited && <Progress value={ratio * 100} showValue={false} tone={tone} label={`${label}: ${used} of ${limit}`} className="mt-1.5" />}
    </div>
  );
}
