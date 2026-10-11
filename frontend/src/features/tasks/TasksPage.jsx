import { useState } from 'react';
import { Download, ListChecks, Plus, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useTasks, downloadTasksCsv } from './api.js';
import { TaskTable } from './components.jsx';
import { TaskFormModal } from './TaskFormModal.jsx';
import { useProjects } from '../projects/api.js';
import { useMemberOptions } from '../team/api.js';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FilterSelect, Pagination, SearchInput } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { PRIORITY, TASK_STATUS, options } from '../../lib/status.js';
import { cn } from '../../lib/cn.js';

const KEYS = ['search', 'status', 'priority', 'assigneeId', 'due', 'projectId', 'includeArchived', 'sort', 'page'];
const SORTS = [
  { value: 'createdAt', label: 'Newest first', order: 'desc' },
  { value: 'dueDate', label: 'Due date', order: 'asc' },
  { value: 'priority', label: 'Priority', order: 'desc' },
  { value: 'title', label: 'Title A–Z', order: 'asc' },
];

export function TasksPage() {
  useDocumentTitle('Tasks');
  const { can, hasFeature } = useAuth();
  const { filters, setFilters, clear, active, activeCount } = useUrlFilters(KEYS);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const projects = useProjects({ pageSize: 100, sort: 'name', order: 'asc' });
  const members = useMemberOptions();

  const sort = SORTS.find((s) => s.value === filters.sort) ?? SORTS[0];
  const query = { ...filters, sort: sort.value, order: sort.order, pageSize: 25 };
  const { data, isLoading, isFetching, error, refetch } = useTasks(query);

  const mine = filters.assigneeId === 'me';

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadTasksCsv({ ...filters, sort: undefined, page: undefined });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description="All work across the projects you can see."
        actions={
          <>
            {hasFeature('DATA_EXPORT') && (
              <Button icon={Download} loading={exporting} onClick={exportCsv} className="max-sm:hidden">
                Export CSV
              </Button>
            )}
            {can('TASK_CREATE') && (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                New task
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 inline-flex rounded-md border border-line-strong bg-surface p-0.5 shadow-xs" role="group" aria-label="Whose tasks">
        {[
          { label: 'All tasks', value: undefined },
          { label: 'My tasks', value: 'me' },
        ].map((o) => {
          const selected = (filters.assigneeId === 'me') === (o.value === 'me');
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilters({ assigneeId: o.value })}
              className={cn('h-9 rounded px-3 text-[13px] font-medium sm:h-7', selected ? 'bg-brand-800 text-white' : 'text-ink-muted hover:text-ink')}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <Toolbar search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search tasks…" className="w-full sm:w-64" label="Search tasks" />} activeCount={activeCount} onClear={clear}>
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(TASK_STATUS)} />
        <FilterSelect label="Priority" value={filters.priority} onChange={(priority) => setFilters({ priority })} options={options(PRIORITY)} allLabel="All priorities" />
        <FilterSelect
          label="Due"
          value={filters.due}
          onChange={(due) => setFilters({ due })}
          allLabel="Any due date"
          options={[
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Due today' },
            { value: 'week', label: 'Next 7 days' },
            { value: 'none', label: 'No due date' },
          ]}
        />
        <FilterSelect
          label="Project"
          value={filters.projectId}
          onChange={(projectId) => setFilters({ projectId })}
          options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
          allLabel="All projects"
          className="max-w-52"
        />
        <FilterSelect
          label="Archived projects"
          value={filters.includeArchived}
          onChange={(includeArchived) => setFilters({ includeArchived })}
          allLabel="Active projects"
          options={[{ value: 'true', label: 'Include archived' }]}
        />
        {!mine && members.data && (
          <FilterSelect
            label="Assignee"
            value={filters.assigneeId}
            onChange={(assigneeId) => setFilters({ assigneeId })}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...members.data.map((m) => ({ value: m.id, label: m.name }))]}
            allLabel="Anyone"
          />
        )}
        <FilterSelect label="Sort" value={filters.sort} onChange={(s) => setFilters({ sort: s })} options={SORTS.slice(1)} allLabel="Newest first" />
      </Toolbar>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        active ? (
          <EmptyState icon={SearchX} title="No tasks match these filters" description="Try a different search or clear the filters." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No tasks yet"
            description="Tasks break projects into work people can pick up."
            action={can('TASK_CREATE') && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create a task</Button>}
          />
        )
      ) : (
        <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
          <TaskTable tasks={data?.items} loading={isLoading} />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </div>
      )}

      <TaskFormModal open={creating} onOpenChange={setCreating} />
    </>
  );
}
