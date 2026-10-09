import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useUpdateTask } from './api.js';
import { useOpenTask } from './useOpenTask.js';
import { Badge, PriorityLabel, StatusBadge } from '../../components/ui/Badge.jsx';
import { Person } from '../../components/ui/Avatar.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Menu, MenuChoice, MenuContent, MenuTrigger } from '../../components/ui/Menu.jsx';
import { PRIORITY, TASK_STATUS } from '../../lib/status.js';
import { dueInfo } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/** What the current user may do with a task — mirrors the API rules (the API still decides). */
export function useTaskAbilities(task) {
  const { can, workspace } = useAuth();
  const isAssignee = !!task?.assignee && task.assignee.id === workspace?.membershipId;
  const canEdit = can('TASK_UPDATE');
  return { canEdit, canChangeStatus: canEdit || isAssignee, canAssign: can('TASK_ASSIGN'), canDelete: can('TASK_DELETE'), isAssignee };
}

export function DueLabel({ date, completed, className }) {
  const due = dueInfo(date, { completed });
  const tones = {
    overdue: 'font-medium text-danger-600',
    today: 'font-medium text-warning-700',
    soon: 'text-ink',
    normal: 'text-ink-muted',
    none: 'text-ink-subtle',
  };
  return (
    <span className={cn('whitespace-nowrap text-[12.5px] tabular-nums', tones[due.tone], className)}>
      {due.label}
      {due.tone === 'overdue' && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

function useStatusChange(task) {
  const update = useUpdateTask();
  return (status) => {
    if (status === task.status) return;
    update.mutate(
      { id: task.id, status },
      {
        onSuccess: () => toast.success(status === 'COMPLETED' ? `Completed “${task.title}”` : `Moved to ${TASK_STATUS[status].label}`),
        onError: (err) => toast.error(err.message ?? "Couldn't update the task. Try again."),
      },
    );
  };
}

/** Status badge that doubles as a picker when the user may change it. */
export function TaskStatusMenu({ task, size = 'sm' }) {
  const { canChangeStatus } = useTaskAbilities(task);
  const change = useStatusChange(task);
  if (!canChangeStatus) return <StatusBadge map={TASK_STATUS} value={task.status} />;
  const s = TASK_STATUS[task.status];
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Status: ${s.label}. Change status`}
        className={cn('inline-flex items-center gap-0.5 rounded focus-visible:outline-2', size === 'md' && 'scale-105')}
      >
        <Badge tone={s.tone} icon={s.icon} className="pr-1">
          {s.label}
          <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
        </Badge>
      </MenuTrigger>
      <MenuContent align="start">
        {Object.entries(TASK_STATUS).map(([value, meta]) => (
          <MenuChoice key={value} icon={meta.icon} selected={value === task.status} onSelect={() => change(value)}>
            {meta.label}
          </MenuChoice>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Round checkbox to complete/reopen a task in one click. */
export function CompleteToggle({ task }) {
  const { canChangeStatus } = useTaskAbilities(task);
  const change = useStatusChange(task);
  const done = task.status === 'COMPLETED';
  if (!canChangeStatus) {
    return <span className={cn('inline-block h-4 w-4 shrink-0 rounded-full border', done ? 'border-success-600 bg-success-600' : 'border-line-strong')} aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      onClick={() => change(done ? 'TODO' : 'COMPLETED')}
      aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” as complete`}
      aria-pressed={done}
      className={cn(
        'inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors max-sm:h-6 max-sm:w-6',
        done ? 'border-success-600 bg-success-600 text-white' : 'border-line-strong text-transparent hover:border-success-600 hover:text-success-600',
      )}
    >
      <Check size={11} strokeWidth={3} aria-hidden="true" />
    </button>
  );
}

/**
 * The standard task list (Tasks page, project Tasks tab).
 * `showProject` adds the project name when tasks from several projects are mixed.
 */
export function TaskTable({ tasks, loading, showProject = true, caption = 'Tasks' }) {
  const openTask = useOpenTask();
  const columns = [
    {
      key: 'title',
      header: 'Task',
      className: 'w-auto',
      cell: (t) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <CompleteToggle task={t} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => openTask(t.id)}
              className={cn('block max-w-full truncate text-left font-medium hover:text-brand-700 hover:underline', t.status === 'COMPLETED' && 'text-ink-muted line-through decoration-ink-subtle/60')}
            >
              {t.title}
            </button>
            {showProject && <span className="block truncate text-xs text-ink-subtle">{t.project.name}</span>}
          </div>
        </div>
      ),
    },
    { key: 'assignee', header: 'Assignee', className: 'w-44', hideBelow: 'lg', cell: (t) => <Person person={t.assignee} className="text-[13px]" /> },
    { key: 'priority', header: 'Priority', className: 'w-28', cell: (t) => <PriorityLabel map={PRIORITY} value={t.priority} /> },
    { key: 'status', header: 'Status', className: 'w-36', cell: (t) => <TaskStatusMenu task={t} /> },
    { key: 'due', header: 'Due', className: 'w-24', cell: (t) => <DueLabel date={t.dueDate} completed={t.status === 'COMPLETED'} /> },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={tasks ?? []}
      loading={loading}
      onRowClick={(t) => openTask(t.id)}
      mobileRow={(t) => (
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <CompleteToggle task={t} />
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => openTask(t.id)}
              className={cn('block w-full text-left text-[14px] font-medium leading-snug', t.status === 'COMPLETED' && 'text-ink-muted line-through')}
            >
              {t.title}
            </button>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TaskStatusMenu task={t} />
              <PriorityLabel map={PRIORITY} value={t.priority} />
              <DueLabel date={t.dueDate} completed={t.status === 'COMPLETED'} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-subtle">
              <Person person={t.assignee} />
              {showProject && <span className="truncate">· {t.project.name}</span>}
            </div>
          </div>
        </div>
      )}
    />
  );
}
