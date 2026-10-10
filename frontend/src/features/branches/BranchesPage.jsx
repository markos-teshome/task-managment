import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, MapPin, MoreHorizontal, Pencil, Plus, SearchX, Star } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useBranches, useUpdateBranch } from './api.js';
import { BranchFormModal } from './BranchFormModal.jsx';
import { ArchiveBranchDialog, ReactivateBranchDialog } from './BranchDialogs.jsx';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { UsageMeter } from '../../components/ui/Progress.jsx';
import { FilterSelect, SearchInput } from '../../components/ui/Misc.jsx';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { EmptyState, ErrorState, PlanLimitNotice } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { BRANCH_STATUS, options } from '../../lib/status.js';

/**
 * Branches of the company. Owners and admins (BRANCH_MANAGE) see and manage all of them; others see the
 * branches they work in. A company only needs one (Head Office) — more appear as it grows.
 */
export function BranchesPage() {
  useDocumentTitle('Branches');
  const { can, workspace } = useAuth();
  const navigate = useNavigate();
  const manage = can('BRANCH_MANAGE');
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['search', 'status']);
  const { data, isLoading, error, refetch, isFetching } = useBranches({ search: filters.search, status: filters.status });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [reactivating, setReactivating] = useState(null);

  const { plan, usage } = workspace;
  const atLimit = plan.maxBranches !== null && usage.branches >= plan.maxBranches;

  const actions = (b) => {
    if (!manage) return null;
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label={`Actions for ${b.name}`} />
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={Pencil} onSelect={() => setEditing(b)}>Edit details</MenuItem>
          {b.status === 'ACTIVE' && !b.isDefault && <DefaultItem branch={b} />}
          {(b.status === 'INACTIVE' || !b.isDefault) && <MenuSeparator />}
          {b.status === 'ACTIVE' && !b.isDefault && (
            <MenuItem icon={Archive} tone="danger" onSelect={() => setArchiving(b)}>Archive branch</MenuItem>
          )}
          {b.status === 'INACTIVE' && <MenuItem icon={ArchiveRestore} onSelect={() => setReactivating(b)}>Reactivate</MenuItem>}
        </MenuContent>
      </Menu>
    );
  };

  const nameCell = (b) => (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5">
        <Link to={`/branches/${b.id}`} className="truncate font-medium hover:text-brand-700 hover:underline">
          {b.name}
        </Link>
        {b.code && <span className="rounded bg-slate-100 px-1 font-mono text-[10.5px] text-ink-muted">{b.code}</span>}
        {b.isDefault && <Badge tone="brand" icon={Star}>Default</Badge>}
      </p>
      {b.address && <p className="truncate text-xs text-ink-subtle">{b.address}</p>}
    </div>
  );

  const columns = [
    { key: 'name', header: 'Branch', className: 'w-auto', cell: nameCell },
    { key: 'manager', header: 'Manager', className: 'w-44', cell: (b) => <span className={b.manager ? '' : 'text-ink-subtle'}>{b.manager?.name ?? 'Not assigned'}</span> },
    { key: 'members', header: 'Members', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (b) => <span className="tabular-nums">{b.memberCount}</span> },
    { key: 'projects', header: 'Projects', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (b) => <span className="tabular-nums">{b.activeProjectCount}</span> },
    { key: 'status', header: 'Status', className: 'w-28', cell: (b) => <StatusBadge map={BRANCH_STATUS} value={b.status} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: actions },
  ];

  return (
    <>
      <PageHeader
        title="Branches"
        description="Manage your company's locations and teams."
        actions={
          manage && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={atLimit}>
              Add branch
            </Button>
          )
        }
      />

      {manage && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <UsageMeter label={`Active branches on the ${plan.name} plan`} used={usage.branches} limit={plan.maxBranches} className="w-full max-w-xs" />
          <span className="text-xs text-ink-subtle">Branches share your plan's members and projects.</span>
        </div>
      )}
      {manage && atLimit && (
        <PlanLimitNotice
          code="SUBSCRIPTION_BRANCH_LIMIT"
          message={`Your ${plan.name} plan includes ${plan.maxBranches} active branch${plan.maxBranches === 1 ? '' : 'es'}. Upgrade to add more, or archive one you no longer use.`}
          className="mb-4"
        />
      )}

      <Toolbar
        search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search branches…" className="w-full sm:w-64" label="Search branches" />}
        activeCount={activeCount}
        onClear={clear}
      >
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(BRANCH_STATUS)} allLabel="Any status" />
      </Toolbar>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.length === 0 ? (
        activeCount ? (
          <EmptyState icon={SearchX} title="No branches match" description="Try another name or status." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={MapPin} title="You're not part of a branch yet" description="When someone adds you to a branch, it appears here." />
        )
      ) : (
        <div className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : undefined}>
          <DataTable
            caption="Branches"
            columns={columns}
            rows={data ?? []}
            loading={isLoading}
            skeletonRows={3}
            onRowClick={(b) => navigate(`/branches/${b.id}`)}
            mobileRow={(b) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {nameCell(b)}
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {b.manager?.name ?? 'No manager'} · {b.memberCount} members · {b.activeProjectCount} projects
                  </p>
                </div>
                {b.status !== 'ACTIVE' && <StatusBadge map={BRANCH_STATUS} value={b.status} />}
                {actions(b)}
              </div>
            )}
          />
        </div>
      )}

      <BranchFormModal open={creating} onOpenChange={setCreating} onCreated={(b) => navigate(`/branches/${b.id}`)} />
      <BranchFormModal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} branch={editing} />
      <ArchiveBranchDialog branch={archiving} onClose={() => setArchiving(null)} />
      <ReactivateBranchDialog branch={reactivating} onClose={() => setReactivating(null)} />
    </>
  );
}

/** "Make default" needs the branch id at mutation time, so it owns its mutation. */
function DefaultItem({ branch }) {
  const update = useUpdateBranch(branch.id);
  return (
    <MenuItem
      icon={Star}
      onSelect={() =>
        update.mutate({ isDefault: true }, { onSuccess: () => toast.success(`${branch.name} is now the default branch`), onError: (e) => toast.error(e.message) })
      }
    >
      Make default
    </MenuItem>
  );
}
