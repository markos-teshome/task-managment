import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, CheckCircle2, MoreHorizontal, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { PageHeader, Section, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Field, FormAlert, Input, Checkbox } from '../../components/ui/Form.jsx';
import { FilterSelect, Pagination, SearchInput, Skeleton } from '../../components/ui/Misc.jsx';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu.jsx';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { FEATURE_LABELS, ORG_STATUS, PAYMENT_STATUS, SUBSCRIPTION_STATUS } from '../../lib/status.js';
import { formatLimit, formatLongDate, formatMoney } from '../../lib/format.js';

/*
 * Platform console for the TeamFlow operator (super admin): tenants, plans and revenue.
 * By design it does not expose any organization's projects, tasks or people.
 */

export function PlatformOverviewPage() {
  useDocumentTitle('Platform');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api.get('/platform/overview') });
  return (
    <>
      <PageHeader title="Platform overview" description="All organizations using TeamFlow." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
            {[
              ['Organizations', data.organizations, data.suspended ? `${data.suspended} suspended` : 'All active'],
              ['Users', data.users, 'Across all organizations'],
              ...data.revenue.map((r) => [`Revenue (${r.currency})`, formatMoney(r.amountCents, r.currency), `${r.payments} payments`]),
            ].map(([label, value, sub]) => (
              <div key={label} className="min-w-[160px] flex-1 bg-surface px-4 py-3">
                <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-ink-muted">{sub}</p>
              </div>
            ))}
          </div>
          <Section title="Organizations by plan">
            <ul className="max-w-md divide-y divide-line rounded-lg border border-line bg-surface">
              {data.organizationsByPlan.map((p) => (
                <li key={p.code} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <span>{p.name}</span>
                  <span className="font-medium tabular-nums">{p.count}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

export function PlatformOrganizationsPage() {
  useDocumentTitle('Organizations');
  const qc = useQueryClient();
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['search', 'status', 'page']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'orgs', filters],
    queryFn: () => api.list('/platform/organizations', { ...filters, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const [confirm, setConfirm] = useState(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/platform/organizations/${id}`, { status }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      toast.success(v.status === 'SUSPENDED' ? 'Organization suspended' : 'Organization reactivated');
      setConfirm(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const columns = [
    { key: 'name', header: 'Organization', className: 'w-auto', cell: (o) => <div><p className="font-medium">{o.name}</p><p className="text-xs text-ink-subtle">Since {formatLongDate(o.createdAt)}</p></div> },
    { key: 'plan', header: 'Plan', className: 'w-32', cell: (o) => <Badge tone="brand">{o.plan?.name ?? '—'}</Badge> },
    { key: 'sub', header: 'Subscription', className: 'w-36', hideBelow: 'lg', cell: (o) => <StatusBadge map={SUBSCRIPTION_STATUS} value={o.subscriptionStatus} /> },
    { key: 'members', header: 'Members', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (o) => <span className="tabular-nums">{o.members}</span> },
    { key: 'projects', header: 'Projects', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (o) => <span className="tabular-nums">{o.projects}</span> },
    { key: 'status', header: 'Status', className: 'w-28', cell: (o) => <StatusBadge map={ORG_STATUS} value={o.status} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12 text-right',
      cell: (o) => (
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label={`Actions for ${o.name}`} />
          </MenuTrigger>
          <MenuContent>
            {o.status === 'ACTIVE' ? (
              <MenuItem icon={Ban} tone="danger" onSelect={() => setConfirm(o)}>Suspend organization</MenuItem>
            ) : (
              <MenuItem icon={CheckCircle2} onSelect={() => setStatus.mutate({ id: o.id, status: 'ACTIVE' })}>Reactivate</MenuItem>
            )}
          </MenuContent>
        </Menu>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Organizations" description="Tenants on the platform and their subscriptions." />
      <Toolbar search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search organizations…" className="w-full sm:w-64" />} activeCount={activeCount} onClear={clear}>
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        <EmptyState icon={Building2} title="No organizations found" />
      ) : (
        <>
          <DataTable
            caption="Organizations"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            mobileRow={(o) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.name}</p>
                  <p className="text-xs text-ink-subtle">{o.plan?.name} · {o.members} members · {o.projects} projects</p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge map={ORG_STATUS} value={o.status} />
                  {columns.at(-1).cell(o)}
                </div>
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Suspend ${confirm?.name}?`}
        description="All of its members lose access on their next request until the organization is reactivated. No data is deleted."
        confirmLabel="Suspend"
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate({ id: confirm.id, status: 'SUSPENDED' })}
      />
    </>
  );
}

export function PlatformPlansPage() {
  useDocumentTitle('Plans & pricing');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api.get('/platform/plans') });
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader title="Plans & pricing" description="Prices, limits and features. Changes apply to new checkouts immediately." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable
          caption="Plans"
          loading={isLoading}
          rows={data ?? []}
          columns={[
            { key: 'name', header: 'Plan', className: 'w-auto', cell: (p) => <div><p className="font-medium">{p.name} {!p.isActive && <Badge>Hidden</Badge>}</p><p className="text-xs text-ink-subtle">{p.code}</p></div> },
            { key: 'price', header: 'Price / month', className: 'w-36 tabular-nums', cell: (p) => (p.priceCents ? formatMoney(p.priceCents, p.currency) : 'Free') },
            { key: 'users', header: 'Members', className: 'w-28', cell: (p) => formatLimit(p.maxUsers) },
            { key: 'projects', header: 'Projects', className: 'w-28', cell: (p) => formatLimit(p.maxProjects) },
            { key: 'features', header: 'Features', className: 'w-56', hideBelow: 'lg', cell: (p) => <span className="text-xs text-ink-muted">{p.features.map((f) => FEATURE_LABELS[f] ?? f).join(', ') || '—'}</span> },
            { key: 'subs', header: 'Orgs', className: 'w-20 text-right', headerClassName: 'w-20 text-right', cell: (p) => <span className="tabular-nums">{p.subscribers}</span> },
            { key: 'edit', header: <span className="sr-only">Edit</span>, className: 'w-20 text-right', cell: (p) => <Button size="sm" icon={Pencil} onClick={() => setEditing(p)}>Edit</Button> },
          ]}
          mobileRow={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{p.name} · {p.priceCents ? formatMoney(p.priceCents, p.currency) : 'Free'}</p>
                <p className="text-xs text-ink-subtle">{formatLimit(p.maxUsers)} members · {formatLimit(p.maxProjects)} projects</p>
              </div>
              <Button size="sm" icon={Pencil} onClick={() => setEditing(p)}>Edit</Button>
            </div>
          )}
        />
      )}
      <PlanEditor plan={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function PlanEditor({ plan, onClose }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  if (plan && draft?.id !== plan.id) {
    setDraft({
      id: plan.id,
      name: plan.name,
      description: plan.description ?? '',
      price: String(plan.priceCents / 100),
      maxUsers: plan.maxUsers ?? '',
      maxProjects: plan.maxProjects ?? '',
      features: plan.features,
      isActive: plan.isActive,
    });
    setError(null);
  }
  const save = useMutation({
    mutationFn: (body) => api.patch(`/platform/plans/${plan.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan saved');
      setDraft(null);
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const submit = (e) => {
    e.preventDefault();
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price.');
    const limit = (v) => (v === '' ? null : Number(v));
    save.mutate({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      priceCents: Math.round(price * 100),
      maxUsers: limit(draft.maxUsers),
      maxProjects: limit(draft.maxProjects),
      features: draft.features,
      isActive: draft.isActive,
    });
  };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <Modal open={!!plan} onOpenChange={(open) => !open && (setDraft(null), onClose())} title={`Edit ${plan?.name ?? ''} plan`}>
      {draft && (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <FormAlert>{error}</FormAlert>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" required>
                <Input value={draft.name} onChange={set('name')} />
              </Field>
              <Field label={`Price per month (${plan.currency})`} required>
                <Input type="number" min="0" step="0.01" inputMode="decimal" value={draft.price} onChange={set('price')} />
              </Field>
              <Field label="Max members" hint="Empty = unlimited">
                <Input type="number" min="1" inputMode="numeric" value={draft.maxUsers} onChange={set('maxUsers')} />
              </Field>
              <Field label="Max active projects" hint="Empty = unlimited">
                <Input type="number" min="1" inputMode="numeric" value={draft.maxProjects} onChange={set('maxProjects')} />
              </Field>
            </div>
            <Field label="Description" optional>
              <Input value={draft.description} onChange={set('description')} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium">Features</legend>
              {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                <Checkbox
                  key={key}
                  label={label}
                  checked={draft.features.includes(key)}
                  onChange={(e) => setDraft((d) => ({ ...d, features: e.target.checked ? [...d.features, key] : d.features.filter((f) => f !== key) }))}
                />
              ))}
            </fieldset>
            <Checkbox label="Available for new subscriptions" checked={draft.isActive} onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save plan
            </Button>
          </DialogFooter>
        </form>
      )}
    </Modal>
  );
}

export function PlatformPaymentsPage() {
  useDocumentTitle('Payments');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'payments', page],
    queryFn: () => api.list('/platform/payments', { page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Payments" description="Every payment attempt across the platform." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <DataTable
            caption="Payments"
            loading={isLoading}
            rows={data?.items ?? []}
            columns={[
              { key: 'date', header: 'Date', className: 'w-36', cell: (p) => formatLongDate(p.createdAt) },
              { key: 'org', header: 'Organization', className: 'w-auto', cell: (p) => <span className="font-medium">{p.organization}</span> },
              { key: 'plan', header: 'Plan', className: 'w-32', cell: (p) => p.plan },
              { key: 'amount', header: 'Amount', className: 'w-32 tabular-nums', cell: (p) => formatMoney(p.amountCents, p.currency) },
              { key: 'provider', header: 'Provider', className: 'w-24', hideBelow: 'lg', cell: (p) => <span className="text-ink-muted">{p.provider}</span> },
              { key: 'status', header: 'Status', className: 'w-28', cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
            ]}
            mobileRow={(p) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.organization}</p>
                  <p className="text-xs text-ink-subtle">{p.plan} · {formatMoney(p.amountCents, p.currency)} · {formatLongDate(p.createdAt)}</p>
                </div>
                <StatusBadge map={PAYMENT_STATUS} value={p.status} />
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </>
  );
}
