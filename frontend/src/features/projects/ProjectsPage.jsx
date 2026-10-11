import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FolderKanban, MapPin, Plus, SearchX } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useProjects } from './api.js';
import { ProjectFormModal } from './ProjectFormModal.jsx';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { PriorityLabel, StatusBadge } from '../../components/ui/Badge.jsx';
import { AvatarStack, Person } from '../../components/ui/Avatar.jsx';
import { Progress } from '../../components/ui/Progress.jsx';
import { FilterSelect, Pagination, SearchInput, usePageRecovery } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { DueLabel } from '../tasks/components.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useBranches, useHasSeveralBranches } from '../branches/api.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { PRIORITY, PROJECT_STATUS, options } from '../../lib/status.js';
import { pluralize } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';
import { onIntent, prefetchProject } from '../../app/preload.js';

const KEYS = ['search', 'status', 'priority', 'branchId', 'archived', 'sort', 'page', 'pageSize'];
const SORTS = {
  createdAt: { label: 'Newest first', order: 'desc' },
  dueDate: { label: 'Due date', order: 'asc' },
  name: { label: 'Name A–Z', order: 'asc' },
  priority: { label: 'Priority', order: 'desc' },
};

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const { can } = useAuth();
  const navigate = useNavigate();
  const { filters, setFilters, clear, active, activeCount } = useUrlFilters(KEYS);
  const [creating, setCreating] = useState(false);
  const sort = SORTS[filters.sort] ? filters.sort : 'createdAt';
  const { data, isLoading, isFetching, error, refetch } = useProjects({ ...filters, sort, order: SORTS[sort].order, pageSize: filters.pageSize ?? 20 });
  const pastEnd = usePageRecovery(data?.meta, (page) => setFilters({ page }));
  const archived = filters.archived === 'true';
  // Branch filter only when there is more than one branch; the list holds the branches this person may see.
  const severalBranches = useHasSeveralBranches();
  const branches = useBranches({}, { enabled: severalBranches });

  const columns = [
    {
      key: 'name',
      header: 'Project',
      className: 'w-auto',
      cell: (p) => (
        <div className="min-w-0">
          <Link to={`/projects/${p.id}`} {...onIntent(() => prefetchProject(p.id))} className="block truncate font-medium hover:text-brand-700 hover:underline">
            {p.name}
          </Link>
          {p.stats.overdue > 0 && <span className="text-xs text-danger-600">{p.stats.overdue} overdue</span>}
          {p.stats.overdue === 0 && <span className="text-xs text-ink-subtle">{pluralize(p.stats.total, 'task')}</span>}
          {p.branch && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-ink-subtle">
              <MapPin size={11} aria-hidden="true" />
              {p.branch.name}
            </span>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Status', className: 'w-32', cell: (p) => <StatusBadge map={PROJECT_STATUS} value={p.status} /> },
    { key: 'priority', header: 'Priority', className: 'w-28', hideBelow: 'lg', cell: (p) => <PriorityLabel map={PRIORITY} value={p.priority} /> },
    { key: 'progress', header: 'Progress', className: 'w-40', cell: (p) => <Progress value={p.stats.progress} label={`${p.name} progress`} /> },
    { key: 'lead', header: 'Lead', className: 'w-40', hideBelow: 'xl', cell: (p) => <Person person={p.lead} emptyLabel="No lead" /> },
    { key: 'team', header: 'Team', className: 'w-32', cell: (p) => <AvatarStack people={p.members} /> },
    { key: 'due', header: 'Due', className: 'w-24', cell: (p) => <DueLabel date={p.dueDate} completed={['COMPLETED', 'CANCELLED'].includes(p.status)} /> },
  ];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Manage and track your organization's projects."
        actions={
          can('PROJECT_CREATE') && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New project
            </Button>
          )
        }
      />

      <Toolbar search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search projects…" className="w-full sm:w-64" label="Search projects" />} activeCount={activeCount} onClear={clear}>
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(PROJECT_STATUS)} />
        <FilterSelect label="Priority" value={filters.priority} onChange={(priority) => setFilters({ priority })} options={options(PRIORITY)} allLabel="All priorities" />
        {severalBranches && branches.data && (
          <FilterSelect
            label="Branch"
            value={filters.branchId}
            onChange={(branchId) => setFilters({ branchId })}
            options={[{ value: 'none', label: 'Organization-wide' }, ...branches.data.map((b) => ({ value: b.id, label: b.name }))]}
            allLabel="All branches"
          />
        )}
        <FilterSelect
          label="Sort"
          value={filters.sort}
          onChange={(s) => setFilters({ sort: s })}
          options={Object.entries(SORTS).slice(1).map(([value, s]) => ({ value, label: s.label }))}
          allLabel="Newest first"
        />
        <div className="inline-flex w-fit rounded-md border border-line-strong bg-surface p-0.5 shadow-xs max-sm:col-span-2 sm:ml-auto" role="group" aria-label="Show">
          {[
            { label: 'Active', value: undefined },
            { label: 'Archived', value: 'true' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={archived === !!o.value}
              onClick={() => setFilters({ archived: o.value })}
              className={cn('h-9 rounded px-2.5 text-[13px] font-medium sm:h-7', archived === !!o.value ? 'bg-brand-800 text-white' : 'text-ink-muted hover:text-ink')}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Toolbar>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && !pastEnd && data.items.length === 0 ? (
        active ? (
          <EmptyState icon={SearchX} title={archived ? 'No archived projects found' : 'No projects match these filters'} description="Try a different search or clear the filters." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description={can('PROJECT_CREATE') ? "Create your first project and start organizing your team's work." : "You haven't been added to any project yet."}
            action={can('PROJECT_CREATE') && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create project</Button>}
          />
        )
      ) : (
        <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
          <DataTable
            caption="Projects"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            onRowClick={(p) => navigate(`/projects/${p.id}`)}
            mobileRow={(p) => (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/projects/${p.id}`} {...onIntent(() => prefetchProject(p.id))} className="min-w-0 text-[14px] font-medium leading-snug">
                    {p.name}
                  </Link>
                  <StatusBadge map={PROJECT_STATUS} value={p.status} />
                </div>
                <Progress value={p.stats.progress} className="mt-2" label={`${p.name} progress`} />
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <AvatarStack people={p.members} max={3} size="xs" />
                  <span className="flex items-center gap-2">
                    {p.stats.overdue > 0 && <span className="text-danger-600">{p.stats.overdue} overdue</span>}
                    <DueLabel date={p.dueDate} completed={p.status === 'COMPLETED'} />
                  </span>
                </div>
              </div>
            )}
          />
        </div>
      )}
      {!error && <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onPageSizeChange={(pageSize) => setFilters({ pageSize: pageSize === 20 ? undefined : pageSize })} />}

      <ProjectFormModal open={creating} onOpenChange={setCreating} onCreated={(p) => navigate(`/projects/${p.id}`)} />
    </>
  );
}
