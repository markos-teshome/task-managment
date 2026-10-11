import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Calendar, ChevronsUp, CircleUserRound, FolderKanban, MoreHorizontal, Trash2, X, CircleDot, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useDeleteTask, useTask, useTaskActivity, useUpdateTask } from './api.js';
import { DueLabel, TaskStatusMenu, useTaskAbilities } from './components.jsx';
import { useProject } from '../projects/api.js';
import { Drawer, ConfirmDialog, DialogClose } from '../../components/ui/Dialog.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input, Select, Textarea } from '../../components/ui/Form.jsx';
import { Person } from '../../components/ui/Avatar.jsx';
import { PriorityLabel } from '../../components/ui/Badge.jsx';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { ErrorState } from '../../components/feedback/States.jsx';
import { ActivityItem } from '../activity/ActivityItem.jsx';
import { PRIORITY } from '../../lib/status.js';
import { formatLongDate, toDateInput } from '../../lib/format.js';

/**
 * Task details in a side drawer: every field is edited in place, next to its value.
 * Employees see the same view but can only move their own task through the workflow.
 */
export function TaskDrawer({ taskId, onClose }) {
  return (
    <Drawer open={!!taskId} onOpenChange={(open) => !open && onClose()} title="Task details" hideHeader>
      {taskId && <TaskDetails id={taskId} onClose={onClose} />}
    </Drawer>
  );
}

function TaskDetails({ id, onClose }) {
  const { data: task, isLoading, error, refetch } = useTask(id);

  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-3/4" />
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex justify-end p-2">
          <DialogClose asChild>
            <Button variant="ghost" size="icon" icon={X} aria-label="Close" />
          </DialogClose>
        </div>
        {error.status === 404 ? (
          <ErrorState title="Task not found" error={{ message: "This task doesn't exist or you no longer have access to it." }} />
        ) : (
          <ErrorState error={error} onRetry={refetch} />
        )}
      </div>
    );
  }
  return <TaskView task={task} onClose={onClose} />;
}

function Property({ icon: Icon, label, children }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 py-1.5 sm:grid-cols-[130px_1fr]">
      <dt className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Icon size={14} className="text-ink-subtle" aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

function TaskView({ task, onClose }) {
  const { can } = useAuth();
  const { canEdit, canAssign, canDelete, readOnly } = useTaskAbilities(task);
  const update = useUpdateTask();
  const remove = useDeleteTask();
  // D-12: only people on the project team can be assigned.
  const project = useProject(canAssign ? task.project.id : null);
  const team = (project.data?.members ?? []).filter((m) => m.status === 'ACTIVE');
  const activity = useTaskActivity(task.id, can('ACTIVITY_VIEW'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description ?? ''), [task.description]);

  const save = (patch, success) =>
    update.mutate(
      { id: task.id, ...patch },
      { onSuccess: () => success && toast.success(success), onError: (err) => toast.error(err.message ?? "Couldn't update the task. Try again.") },
    );

  const saveTitle = () => {
    const next = title.trim();
    if (next.length < 2) return setTitle(task.title);
    if (next !== task.title) save({ title: next });
  };

  const descriptionDirty = (task.description ?? '') !== description;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-4">
        <Link to={`/projects/${task.project.id}`} onClick={onClose} className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-muted hover:text-brand-700">
          <FolderKanban size={14} aria-hidden="true" />
          <span className="truncate">{task.project.name}</span>
        </Link>
        <div className="flex items-center gap-1">
          {canDelete && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" icon={MoreHorizontal} aria-label="More actions" />
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={Trash2} tone="danger" onSelect={() => setConfirmDelete(true)}>
                  Delete task
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
          <DialogClose asChild>
            <Button variant="ghost" size="icon" icon={X} aria-label="Close task" />
          </DialogClose>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {readOnly && (
          <p className="mb-3 rounded-md border border-line bg-slate-50 px-3 py-2 text-[12.5px] text-ink-muted">
            This task belongs to an archived project. It is kept as read-only history.
          </p>
        )}
        {canEdit ? (
          <textarea
            aria-label="Task title"
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            className="field-sizing-content w-full resize-none rounded-md border border-transparent px-1.5 py-1 -mx-1.5 text-lg font-semibold leading-snug hover:border-line focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        ) : (
          <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
        )}

        <dl className="mt-3 divide-y divide-line/60">
          <Property icon={CircleDot} label="Status">
            <TaskStatusMenu task={task} />
          </Property>
          <Property icon={CircleUserRound} label="Assignee">
            {canAssign ? (
              <Select
                aria-label="Assignee"
                value={task.assignee?.id ?? ''}
                onChange={(e) => save({ assigneeId: e.target.value || null }, 'Assignee updated')}
                className="max-w-60"
              >
                <option value="">Unassigned</option>
                {task.assignee && !team.some((m) => m.id === task.assignee.id) && (
                  <option value={task.assignee.id}>
                    {task.assignee.name}
                    {task.assignee.status === 'ACTIVE' ? '' : ' (deactivated)'}
                  </option>
                )}
                {team.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            ) : (
              <Person person={task.assignee} />
            )}
          </Property>
          <Property icon={ChevronsUp} label="Priority">
            {canEdit ? (
              <Select aria-label="Priority" value={task.priority} onChange={(e) => save({ priority: e.target.value })} className="max-w-40">
                {Object.entries(PRIORITY).map(([v, p]) => (
                  <option key={v} value={v}>{p.label}</option>
                ))}
              </Select>
            ) : (
              <PriorityLabel map={PRIORITY} value={task.priority} />
            )}
          </Property>
          <Property icon={Calendar} label="Due date">
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label="Due date"
                  value={toDateInput(task.dueDate)}
                  onChange={(e) => save({ dueDate: e.target.value || null })}
                  className="max-w-44"
                />
                {task.dueDate && <DueLabel date={task.dueDate} completed={task.status === 'COMPLETED'} />}
              </div>
            ) : (
              <DueLabel date={task.dueDate} completed={task.status === 'COMPLETED'} />
            )}
          </Property>
          <Property icon={Clock3} label="Created">
            <span className="text-ink-muted">
              {formatLongDate(task.createdAt)}
              {task.createdBy && ` by ${task.createdBy.name}`}
            </span>
          </Property>
          {task.completedAt && (
            <Property icon={Clock3} label="Completed">
              <span className="text-ink-muted">{formatLongDate(task.completedAt)}</span>
            </Property>
          )}
        </dl>

        <section className="mt-5" aria-labelledby="desc-h">
          <h3 id="desc-h" className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Description</h3>
          {canEdit ? (
            <>
              <Textarea aria-labelledby="desc-h" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add more detail…" />
              {descriptionDirty && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDescription(task.description ?? '')}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" loading={update.isPending} onClick={() => save({ description: description.trim() || null }, 'Description saved')}>
                    Save
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">{task.description || 'No description.'}</p>
          )}
        </section>

        {can('ACTIVITY_VIEW') && (
          <section className="mt-6" aria-labelledby="act-h">
            <h3 id="act-h" className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Activity</h3>
            {activity.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : activity.data?.items.length ? (
              <ol className="relative">
                {activity.data.items.map((a) => (
                  <ActivityItem key={a.id} activity={a} compact />
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-ink-subtle">No activity yet.</p>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete task?"
        description={`“${task.title}” will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete task"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(task.id, {
            onSuccess: () => {
              toast.success('Task deleted');
              setConfirmDelete(false);
              onClose();
            },
            onError: (err) => toast.error(err.message),
          })
        }
      />
    </div>
  );
}
