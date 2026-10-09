import { cn } from '../../lib/cn.js';

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
  info: 'bg-info-50 text-info-600 ring-info-600/15',
  success: 'bg-success-50 text-success-700 ring-success-600/15',
  warning: 'bg-warning-50 text-warning-700 ring-warning-600/15',
  danger: 'bg-danger-50 text-danger-700 ring-danger-600/15',
  violet: 'bg-violet-50 text-violet-600 ring-violet-600/15',
};

export function Badge({ tone = 'neutral', icon: Icon, className, children }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11.5px] font-medium ring-1 ring-inset', TONES[tone], className)}>
      {Icon && <Icon size={12} strokeWidth={2.25} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Renders any status from lib/status.js maps: <StatusBadge map={TASK_STATUS} value="BLOCKED" />. */
export function StatusBadge({ map, value, className }) {
  const s = map[value];
  if (!s) return null;
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Badge>
  );
}

/** Priority shown as a compact icon + label without a filled background (less visual noise in tables). */
export function PriorityLabel({ map, value, className }) {
  const p = map[value];
  if (!p) return null;
  const colors = { danger: 'text-danger-600', warning: 'text-warning-600', info: 'text-info-600', neutral: 'text-ink-subtle' };
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12.5px] text-ink-muted', className)}>
      <p.icon size={14} strokeWidth={2.5} className={colors[p.tone]} aria-hidden="true" />
      {p.label}
    </span>
  );
}
