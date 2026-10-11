import { AlarmClock, CheckCircle2, CreditCard, FolderKanban, UserPlus, UserCheck, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/** One small icon per kind of news, in a neutral or meaningful tone (colour is never the only signal: the title says it). */
const KIND = {
  TASK_ASSIGNED: [UserCheck, 'brand'],
  TASK_UNASSIGNED: [UserCheck, 'neutral'],
  TASK_DUE_SOON: [AlarmClock, 'warning'],
  TASK_OVERDUE: [AlarmClock, 'danger'],
  TASK_COMPLETED: [CheckCircle2, 'success'],
  PROJECT_MEMBER_ADDED: [FolderKanban, 'brand'],
  PROJECT_MEMBER_REMOVED: [FolderKanban, 'neutral'],
  PROJECT_LEAD_ASSIGNED: [FolderKanban, 'brand'],
  PROJECT_DUE_SOON: [AlarmClock, 'warning'],
  PROJECT_COMPLETED: [CheckCircle2, 'success'],
  INVITATION_ACCEPTED: [UserPlus, 'brand'],
  SUBSCRIPTION_EXPIRING: [CreditCard, 'warning'],
  SUBSCRIPTION_EXPIRED: [CreditCard, 'danger'],
  PAYMENT_SUCCEEDED: [CreditCard, 'success'],
  PAYMENT_FAILED: [XCircle, 'danger'],
};
const TONE = {
  brand: 'bg-brand-50 text-brand-700',
  neutral: 'bg-slate-100 text-ink-muted',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-600',
  success: 'bg-success-50 text-success-600',
};

export function NotificationIcon({ notification, className }) {
  const [Icon, tone] = KIND[notification.type] ?? [FolderKanban, 'neutral'];
  return (
    <span className={cn('mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md', TONE[tone], className)}>
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
