import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Ban, Building2, CheckCircle2, Eye, MoreHorizontal, SearchX } from 'lucide-react';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { FilterSelect, Pagination, SearchInput } from '../../components/ui/Misc.jsx';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { ORG_STATUS, SUBSCRIPTION_STATUS, options } from '../../lib/status.js';
import { formatLongDate } from '../../lib/format.js';
import { OrganizationStatusDialog, usePlatformQuery } from './shared.jsx';

/** Every company on the platform — administrative metadata only (no projects, tasks or people's work). */
export function PlatformOrganizationsPage() {
  useDocumentTitle('Organizations');
  const navigate = useNavigate();
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['search', 'status', 'planCode', 'page']);
  const { data, isLoading, isFetching, error, refetch } = usePlatformQuery('/organizations', { ...filters, pageSize: 25 });
  const plans = usePlatformQuery('/plans');
  const [changing, setChanging] = useState(null);

  const actions = (o) => (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label={`Actions for ${o.name}`} />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={Eye} onSelect={() => navigate(`/platform/organizations/${o.id}`)}>View details</MenuItem>
        <MenuSeparator />
        {o.status === 'ACTIVE' ? (
          <MenuItem icon={Ban} tone="danger" onSelect={() => setChanging(o)}>Suspend…</MenuItem>
        ) : (
          <MenuItem icon={CheckCircle2} onSelect={() => setChanging(o)}>Reactivate…</MenuItem>
        )}
      </MenuContent>
    </Menu>
  );

  const nameCell = (o) => (
    <Link to={`/platform/organizations/${o.id}`} className="block truncate font-medium hover:text-brand-700 hover:underline">
      {o.name}
    </Link>
  );

  const columns = [
    { key: 'name', header: 'Company', className: 'w-auto', cell: nameCell },
    { key: 'plan', header: 'Plan', className: 'w-32', cell: (o) => <Badge tone="brand">{o.plan?.name ?? '—'}</Badge> },
    { key: 'sub', header: 'Billing', className: 'w-28', hideBelow: 'lg', cell: (o) => <StatusBadge map={SUBSCRIPTION_STATUS} value={o.subscriptionStatus} /> },
    { key: 'members', header: 'Members', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (o) => <span className="tabular-nums">{o.activeMembers}</span> },
    { key: 'branches', header: 'Branches', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (o) => <span className="tabular-nums">{o.activeBranches}</span> },
    { key: 'status', header: 'Status', className: 'w-28', cell: (o) => <StatusBadge map={ORG_STATUS} value={o.status} /> },
    { key: 'created', header: 'Registered', className: 'w-32', hideBelow: 'xl', cell: (o) => <span className="text-ink-muted">{formatLongDate(o.createdAt)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: actions },
  ];

  return (
    <>
      <PageHeader title="Organizations" description="Companies using TeamFlow, their plans and access." />
      <Toolbar
        search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search companies…" className="w-full sm:w-64" label="Search companies" />}
        activeCount={activeCount}
        onClear={clear}
      >
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(ORG_STATUS)} allLabel="Any status" />
        <FilterSelect
          label="Plan"
          value={filters.planCode}
          onChange={(planCode) => setFilters({ planCode })}
          options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))}
          allLabel="All plans"
        />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        activeCount ? (
          <EmptyState icon={SearchX} title="No companies match" description="Try another name, plan or status." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={Building2} title="No companies yet" description="Companies appear here when they register." />
        )
      ) : (
        <div className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : undefined}>
          <DataTable
            caption="Organizations"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            onRowClick={(o) => navigate(`/platform/organizations/${o.id}`)}
            mobileRow={(o) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {nameCell(o)}
                  <p className="text-xs text-ink-subtle">{o.plan?.name ?? '—'} · {o.activeMembers} members · {o.activeBranches} branches</p>
                </div>
                <StatusBadge map={ORG_STATUS} value={o.status} />
                {actions(o)}
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </div>
      )}
      <OrganizationStatusDialog org={changing} onClose={() => setChanging(null)} />
    </>
  );
}
