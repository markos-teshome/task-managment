import { CheckCircle2, PartyPopper } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMyWork } from './api.js';
import { CompleteToggle, DueLabel, TaskStatusMenu } from './components.jsx';
import { useOpenTask } from './useOpenTask.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { PriorityLabel } from '../../components/ui/Badge.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { PRIORITY } from '../../lib/status.js';
import { pluralize } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

const SECTIONS = [
  { key: 'overdue', title: 'Overdue', hint: 'Past their due date', accent: 'text-danger-600' },
  { key: 'today', title: 'Today', hint: 'Due today', accent: 'text-warning-700' },
  { key: 'upcoming', title: 'Upcoming', hint: 'Later or without a date', accent: 'text-ink' },
  { key: 'completed', title: 'Recently completed', hint: 'Last 14 days', accent: 'text-success-700' },
];

/** A compact row used by My Work and the dashboard. */
export function WorkRow({ task }) {
  const openTask = useOpenTask();
  const done = task.status === 'COMPLETED';
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-canvas/70 sm:py-2">
      <CompleteToggle task={task} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => openTask(task.id)} className={cn('block max-w-full truncate text-left text-[13.5px] font-medium hover:text-brand-700', done && 'text-ink-muted line-through')}>
          {task.title}
        </button>
        <span className="block truncate text-xs text-ink-subtle">{task.project.name}</span>
      </div>
      <PriorityLabel map={PRIORITY} value={task.priority} className="hidden sm:inline-flex sm:w-20" />
      <span className="hidden sm:block">
        <TaskStatusMenu task={task} />
      </span>
      <DueLabel date={task.dueDate} completed={done} className="w-20 text-right" />
    </li>
  );
}

export function MyWorkPage() {
  useDocumentTitle('My Work');
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useMyWork();

  const openCount = data ? data.overdue.length + data.today.length + data.upcoming.length : 0;

  return (
    <>
      <PageHeader
        title="My Work"
        description={
          data
            ? openCount
              ? `${pluralize(openCount, 'open task')} assigned to you${data.overdue.length ? ` · ${data.overdue.length} overdue` : ''}.`
              : 'Nothing open right now.'
            : `Tasks assigned to ${user.firstName}.`
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-6">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
      ) : openCount === 0 && data.completed.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No tasks assigned to you" description="When someone assigns you a task, it will show up here." />
      ) : (
        <div className="space-y-6">
          {openCount === 0 && (
            <div className="flex items-center gap-2 rounded-md bg-success-50 px-3 py-2 text-[13px] text-success-700">
              <PartyPopper size={16} aria-hidden="true" /> All caught up — no open tasks.
            </div>
          )}
          {SECTIONS.map(({ key, title, hint, accent }) => {
            const tasks = data[key];
            if (!tasks.length) return null;
            return (
              <section key={key} aria-labelledby={`mw-${key}`}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h2 id={`mw-${key}`} className={cn('text-[13px] font-semibold', accent)}>
                    {title}
                  </h2>
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] tabular-nums text-ink-muted">{tasks.length}</span>
                  <span className="text-xs text-ink-subtle">{hint}</span>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                  {tasks.map((t) => (
                    <WorkRow key={t.id} task={t} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
