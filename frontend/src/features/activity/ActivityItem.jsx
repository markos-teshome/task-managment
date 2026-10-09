import { CheckCircle2, CreditCard, FolderKanban, Shield, SquareCheck, UserPlus, Building2 } from 'lucide-react';
import { formatTime, relativeTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

const ICONS = {
  PROJECT: { icon: FolderKanban, className: 'bg-brand-50 text-brand-600' },
  TASK: { icon: SquareCheck, className: 'bg-info-50 text-info-600' },
  MEMBER: { icon: UserPlus, className: 'bg-violet-50 text-violet-600' },
  ROLE: { icon: Shield, className: 'bg-slate-100 text-slate-600' },
  SUBSCRIPTION: { icon: CreditCard, className: 'bg-accent-50 text-accent-700' },
  PAYMENT: { icon: CreditCard, className: 'bg-accent-50 text-accent-700' },
  ORGANIZATION: { icon: Building2, className: 'bg-slate-100 text-slate-600' },
};

/** One line of history: "<Actor> <did something>" + time. Completed tasks get a success mark. */
export function ActivityItem({ activity: a, compact = false, showClock = false }) {
  const meta = a.action === 'TASK_COMPLETED' ? { icon: CheckCircle2, className: 'bg-success-50 text-success-600' } : ICONS[a.entityType] ?? ICONS.ORGANIZATION;
  const Icon = meta.icon;
  return (
    <li className={cn('relative flex gap-3', compact ? 'py-1.5' : 'py-2')}>
      {showClock && (
        <time dateTime={a.createdAt} className="w-10 shrink-0 pt-1 text-right text-xs tabular-nums text-ink-subtle">
          {formatTime(a.createdAt)}
        </time>
      )}
      <span className={cn('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full', meta.className)} aria-hidden="true">
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <span className="font-medium text-ink">{a.actor?.name ?? 'TeamFlow'}</span> <span className="text-ink-muted">{a.message}</span>
        {!showClock && (
          <time dateTime={a.createdAt} className="ml-1.5 whitespace-nowrap text-xs text-ink-subtle">
            {relativeTime(a.createdAt)}
          </time>
        )}
      </div>
    </li>
  );
}
