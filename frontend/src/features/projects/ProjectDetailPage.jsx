import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Archive, ArchiveRestore, ArrowLeft, Calendar, Crown, ListChecks, MapPin, MoreHorizontal, Pencil, Plus, SearchX, Trash2, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useAddProjectMembers, useArchiveProject, useDeleteProject, useProject, useProjectActivity, useRemoveProjectMember } from './api.js';
import { ProjectFormModal } from './ProjectFormModal.jsx';
import { useTasks } from '../tasks/api.js';
import { TaskTable, DueLabel } from '../tasks/components.jsx';
import { TaskFormModal } from '../tasks/TaskFormModal.jsx';
import { MemberPicker } from '../team/MemberPicker.jsx';
import { ActivityItem } from '../activity/ActivityItem.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PriorityLabel, StatusBadge } from '../../components/ui/Badge.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Progress } from '../../components/ui/Progress.jsx';
import { FilterSelect, Pagination, SearchInput, Skeleton, Tabs, usePageRecovery } from '../../components/ui/Misc.jsx';
import { Field, Input } from '../../components/ui/Form.jsx';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Section } from '../../components/layout/PageHeader.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { PRIORITY, PROJECT_STATUS, TASK_STATUS, options } from '../../lib/status.js';
import { formatDate, formatLongDate, pluralize } from '../../lib/format.js';

export function ProjectDetailPage() {
  const { id } = useParams();
  const { data: project, isLoading, error, refetch } = useProject(id);
  useDocumentTitle(project?.name ?? 'Project');

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-3 h-4 w-20" />
        <Skeleton className="mb-2 h-7 w-72 max-w-full" />
        <Skeleton className="mb-6 h-4 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error) {
    return error.status === 404 ? (
      <EmptyState
        icon={SearchX}
        title="Project not found"
        description="It may have been deleted, or you don't have access to it."
        action={<Link to="/projects" className="text-[13px] font-medium text-brand-700 hover:underline">Back to projects</Link>}
      />
    ) : (
      <ErrorState error={error} onRetry={refetch} />
    );
  }
  return <ProjectWorkspace project={project} />;
}

function ProjectWorkspace({ project }) {
  const { can, workspace } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState('');
  const archive = useArchiveProject(project.id);
  const remove = useDeleteProject(project.id, () => {
    toast.success('Project permanently deleted');
    navigate('/projects', { replace: true });
  });

  const tab = params.get('tab') ?? 'overview';
  const setTab = (value) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === 'overview') next.delete('tab');
      else next.set('tab', value);
      return next;
    });

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'tasks', label: 'Tasks', count: project.stats.total },
    { value: 'team', label: 'Team', count: project.members.length },
    ...(can('ACTIVITY_VIEW') ? [{ value: 'activity', label: 'Activity' }] : []),
  ];

  const toggleArchive = () =>
    archive.mutate(!project.archivedAt, {
      onSuccess: () => toast.success(project.archivedAt ? 'Project restored' : 'Project archived'),
      onError: (err) => toast.error(err.message),
    });

  // The API says what this person may do here (management scope, D-3); permanent deletion is the
  // Owner's, only for archived projects (D-1).
  const canManage = project.canManage;
  const canDelete = workspace?.role.key === 'OWNER' && can('PROJECT_DELETE') && !!project.archivedAt;

  return (
    <>
      <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-brand-700">
        <ArrowLeft size={14} aria-hidden="true" /> Projects
      </Link>

      {project.archivedAt && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-slate-50 px-3 py-2 text-[13px] text-ink-muted">
          <span className="flex items-center gap-2">
            <Archive size={15} aria-hidden="true" /> This project was archived on {formatLongDate(project.archivedAt)}. It is read-only.
          </span>
          {canManage && (
            <Button size="sm" icon={ArchiveRestore} loading={archive.isPending} onClick={toggleArchive}>
              Restore
            </Button>
          )}
        </div>
      )}

      <header className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{project.name}</h1>
            <StatusBadge map={PROJECT_STATUS} value={project.status} />
            <PriorityLabel map={PRIORITY} value={project.priority} />
            {project.branch && (
              <Link to={`/branches/${project.branch.id}`} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700">
                <MapPin size={12} aria-hidden="true" />
                {project.branch.name}
              </Link>
            )}
          </div>
          {project.description && <p className="mt-1 max-w-3xl text-[13px] text-ink-muted">{project.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canManage && !project.archivedAt && (
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {(canManage || canDelete) && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" icon={MoreHorizontal} aria-label="More project actions" />
              </MenuTrigger>
              <MenuContent>
                {canManage && (
                  <MenuItem icon={project.archivedAt ? ArchiveRestore : Archive} onSelect={toggleArchive}>
                    {project.archivedAt ? 'Restore project' : 'Archive project'}
                  </MenuItem>
                )}
                {canDelete && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={Trash2} tone="danger" onSelect={() => setConfirmDelete(true)}>
                      Delete permanently…
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </header>

      <div className="mb-3 mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <div className="flex w-full items-center gap-2 sm:w-56">
          <Progress value={project.stats.progress} label="Project progress" className="flex-1" />
          <span className="text-ink-muted">complete</span>
        </div>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <Calendar size={14} aria-hidden="true" /> Due <DueLabel date={project.dueDate} completed={project.status === 'COMPLETED'} />
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <Users size={14} aria-hidden="true" /> {pluralize(project.members.length, 'member')}
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <ListChecks size={14} aria-hidden="true" /> {project.stats.completed}/{project.stats.total} tasks done
          {project.stats.overdue > 0 && <span className="text-danger-600">· {project.stats.overdue} overdue</span>}
        </span>
      </div>

      <div className="mb-4 border-b border-line">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab project={project} onShowTasks={() => setTab('tasks')} />}
        {tab === 'tasks' && <TasksTab project={project} />}
        {tab === 'team' && <TeamTab project={project} />}
        {tab === 'activity' && <ActivityTab project={project} />}
      </div>

      <ProjectFormModal open={editing} onOpenChange={setEditing} project={project} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          setTypedName('');
        }}
        title="Permanently delete this project?"
        description={`“${project.name}” and its ${pluralize(project.stats.total, 'task')} will be deleted for good. The activity history keeps a record of the project and of this deletion. This cannot be undone.`}
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        onConfirm={() =>
          typedName.trim() === project.name &&
          remove.mutate(typedName.trim(), { onError: (err) => toast.error(err.message) })
        }
      >
        <Field label={`Type “${project.name}” to confirm`} className="mt-3">
          <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function OverviewTab({ project, onShowTasks }) {
  const { can } = useAuth();
  const s = project.stats;
  const todo = s.total - s.completed - s.inProgress - s.blocked;
  const breakdown = [
    { key: 'TODO', value: todo },
    { key: 'IN_PROGRESS', value: s.inProgress },
    { key: 'BLOCKED', value: s.blocked },
    { key: 'COMPLETED', value: s.completed },
  ];
  const activity = useProjectActivity(project.id, can('ACTIVITY_VIEW'));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Section title="Tasks by status" action={<Button variant="link" size="sm" onClick={onShowTasks}>View all tasks</Button>}>
          {s.total === 0 ? (
            <p className="text-[13px] text-ink-subtle">No tasks yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {breakdown.map(({ key, value }) => {
                const meta = TASK_STATUS[key];
                return (
                  <li key={key} className="bg-surface px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                      <meta.icon size={13} aria-hidden="true" /> {meta.label}
                    </span>
                    <span className="mt-0.5 block text-lg font-semibold tabular-nums">{value}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {can('ACTIVITY_VIEW') && (
          <Section title="Recent activity">
            {activity.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : activity.data?.length ? (
              <ol>{activity.data.slice(0, 6).map((a) => <ActivityItem key={a.id} activity={a} compact />)}</ol>
            ) : (
              <p className="text-[13px] text-ink-subtle">No activity yet.</p>
            )}
          </Section>
        )}
      </div>

      <Section title="Details">
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
          {[
            ['Lead', project.lead ? <span className="inline-flex items-center gap-1.5"><Avatar name={project.lead.name} size="xs" />{project.lead.name}</span> : <span className="text-ink-subtle">No lead</span>],
            ['Status', <StatusBadge key="s" map={PROJECT_STATUS} value={project.status} />],
            ['Priority', <PriorityLabel key="p" map={PRIORITY} value={project.priority} />],
            ['Start date', formatDate(project.startDate)],
            ['Due date', formatDate(project.dueDate)],
            ['Created', formatLongDate(project.createdAt)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="min-w-0 truncate text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function TasksTab({ project }) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useTasks({ projectId: project.id, search, status, page, pageSize, sort: 'dueDate', order: 'asc' });
  const pastEnd = usePageRecovery(data?.meta, setPage);
  // D-3/D-6: tasks are created in projects the person manages or is on; archived projects are read-only.
  const canCreate = can('TASK_CREATE') && project.inScope && !project.archivedAt;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search tasks…" className="w-full sm:w-56" label="Search project tasks" />
        <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={options(TASK_STATUS)} className="max-sm:flex-1" />
        {canCreate && (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} className="sm:ml-auto max-sm:flex-1">
            New task
          </Button>
        )}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && !pastEnd && data.items.length === 0 ? (
        search || status ? (
          <EmptyState compact icon={SearchX} title="No matching tasks" description="Try a different search or status." />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No tasks in this project yet"
            description="Break the project into tasks and assign them to the team."
            action={canCreate && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Add the first task</Button>}
          />
        )
      ) : (
        <>
          <TaskTable tasks={data?.items} loading={isLoading} showProject={false} caption={`Tasks in ${project.name}`} />
        </>
      )}
      {!error && <Pagination meta={data?.meta} onPageChange={setPage} onPageSizeChange={(n) => (setPageSize(n), setPage(1))} />}
      <TaskFormModal open={creating} onOpenChange={setCreating} projectId={project.id} />
    </>
  );
}

function TeamTab({ project }) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState([]);
  const add = useAddProjectMembers(project.id);
  const removeMember = useRemoveProjectMember(project.id);
  const canEdit = project.canManage && !project.archivedAt;

  const submit = () =>
    add.mutate(selected, {
      onSuccess: () => {
        toast.success(selected.length === 1 ? 'Member added' : `${selected.length} members added`);
        setSelected([]);
        setAdding(false);
      },
      onError: (err) => toast.error(err.message),
    });

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-muted">People on the team can see this project and its tasks.</p>
        {canEdit && (
          <Button icon={UserPlus} onClick={() => setAdding(true)}>
            Add members
          </Button>
        )}
      </div>
      {project.members.length === 0 ? (
        <EmptyState icon={Users} title="No one on this team yet" description="Add the people responsible for this project." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {project.members.map((m) => {
            const isLead = project.lead?.id === m.id;
            return (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={m.name} size="md" inactive={m.status === 'DEACTIVATED'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{m.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {isLead ? (
                      <span className="inline-flex items-center gap-1 text-accent-700"><Crown size={12} aria-hidden="true" /> Project lead</span>
                    ) : m.status === 'DEACTIVATED' ? 'Deactivated' : 'Member'}
                  </p>
                </div>
                {canEdit && !isLead && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    icon={X}
                    aria-label={`Remove ${m.name} from the project`}
                    onClick={() => removeMember.mutate(m.id, { onSuccess: () => toast.success(`${m.name} removed from the team`), onError: (err) => toast.error(err.message) })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={adding} onOpenChange={setAdding} title="Add team members" description={project.name}>
        <DialogBody>
          <MemberPicker value={selected} onChange={setSelected} exclude={project.members.map((m) => m.id)} />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="primary" disabled={!selected.length} loading={add.isPending} onClick={submit}>
            Add {selected.length > 0 && selected.length}
          </Button>
        </DialogFooter>
      </Modal>
    </>
  );
}

function ActivityTab({ project }) {
  const { data, isLoading, error, refetch } = useProjectActivity(project.id, true);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data.length) return <EmptyState compact title="No activity yet" description="Changes to this project and its tasks will appear here." />;
  return (
    <ol className="max-w-3xl">
      {data.map((a) => (
        <ActivityItem key={a.id} activity={a} />
      ))}
    </ol>
  );
}
