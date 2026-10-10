import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Receipt, Repeat, SearchX } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Field, FormAlert, Input, Checkbox } from '../../components/ui/Form.jsx';
import { FilterSelect, Pagination, SearchInput } from '../../components/ui/Misc.jsx';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { FEATURE_LABELS, PAYMENT_STATUS, SUBSCRIPTION_STATUS, options } from '../../lib/status.js';
import { formatDate, formatLimit, formatLongDate, formatMoney } from '../../lib/format.js';
import { usePlatformQuery } from './shared.jsx';

const SUB_FILTERS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'CANCELING', label: 'Cancelling at period end' },
  { value: 'EXPIRED', label: 'Expired' },
];

export function PlatformSubscriptionsPage() {
  useDocumentTitle('Subscriptions');
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['status', 'planCode', 'endingWithinDays', 'page']);
  const { data, isLoading, error, refetch } = usePlatformQuery('/subscriptions', { ...filters, pageSize: 25 });
  const plans = usePlatformQuery('/plans');

  const columns = [
    { key: 'org', header: 'Company', className: 'w-auto', cell: (s) => <Link to={`/platform/organizations/${s.organization.id}`} className="block truncate font-medium hover:text-brand-700 hover:underline">{s.organization.name}</Link> },
    { key: 'plan', header: 'Plan', className: 'w-32', cell: (s) => <Badge tone="brand">{s.plan.name}</Badge> },
    { key: 'price', header: 'Price', className: 'w-28 tabular-nums', hideBelow: 'lg', cell: (s) => (s.plan.priceCents ? formatMoney(s.plan.priceCents, s.plan.currency) : 'Free') },
    { key: 'status', header: 'Status', className: 'w-28', cell: (s) => <StatusBadge map={SUBSCRIPTION_STATUS} value={s.status} /> },
    {
      key: 'end',
      header: 'Renewal',
      className: 'w-40',
      cell: (s) => (s.currentPeriodEnd ? <span className={s.cancelAtPeriodEnd ? 'text-warning-700' : 'text-ink-muted'}>{s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatLongDate(s.currentPeriodEnd)}</span> : <span className="text-ink-subtle">No end date</span>),
    },
  ];

  return (
    <>
      <PageHeader title="Subscriptions" description="Every company's plan, status and renewal date." />
      <Toolbar activeCount={activeCount} onClear={clear}>
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={SUB_FILTERS} allLabel="Any status" />
        <FilterSelect label="Plan" value={filters.planCode} onChange={(planCode) => setFilters({ planCode })} options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))} allLabel="All plans" />
        <FilterSelect
          label="Renewal"
          value={filters.endingWithinDays}
          onChange={(endingWithinDays) => setFilters({ endingWithinDays })}
          options={[{ value: '7', label: 'Ends within 7 days' }, { value: '30', label: 'Ends within 30 days' }]}
          allLabel="Any renewal date"
        />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        <EmptyState icon={activeCount ? SearchX : Repeat} title={activeCount ? 'No subscriptions match' : 'No subscriptions yet'} />
      ) : (
        <>
          <DataTable
            caption="Subscriptions"
            rowKey={(s) => s.organization.id}
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            mobileRow={(s) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {columns[0].cell(s)}
                  <p className="text-xs text-ink-subtle">{s.plan.name} · {s.currentPeriodEnd ? `${s.cancelAtPeriodEnd ? 'ends' : 'renews'} ${formatDate(s.currentPeriodEnd)}` : 'no end date'}</p>
                </div>
                <StatusBadge map={SUBSCRIPTION_STATUS} value={s.status} />
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </>
      )}
    </>
  );
}

export function PlatformPaymentsPage() {
  useDocumentTitle('Payments');
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['search', 'status', 'page']);
  const { data, isLoading, error, refetch } = usePlatformQuery('/payments', { ...filters, pageSize: 25 });

  const columns = [
    { key: 'date', header: 'Date', className: 'w-32', cell: (p) => formatLongDate(p.createdAt) },
    { key: 'org', header: 'Company', className: 'w-auto', cell: (p) => <Link to={`/platform/organizations/${p.organizationId}`} className="block truncate font-medium hover:text-brand-700 hover:underline">{p.organization}</Link> },
    { key: 'plan', header: 'Plan', className: 'w-28', hideBelow: 'lg', cell: (p) => p.plan },
    { key: 'amount', header: 'Amount', className: 'w-28 tabular-nums', cell: (p) => formatMoney(p.amountCents, p.currency) },
    { key: 'ref', header: 'Reference', className: 'w-52', hideBelow: 'xl', cell: (p) => <code className="truncate font-mono text-[11.5px] text-ink-subtle" title={p.txRef}>{p.txRef}</code> },
    { key: 'provider', header: 'Provider', className: 'w-24', hideBelow: 'lg', cell: (p) => <span className="text-ink-muted">{p.provider}</span> },
    { key: 'status', header: 'Status', className: 'w-28', cell: (p) => <span title={p.failureReason ?? undefined}><StatusBadge map={PAYMENT_STATUS} value={p.status} /></span> },
  ];

  return (
    <>
      <PageHeader title="Payments" description="Every payment attempt across the platform. Payments are confirmed only by the payment provider." />
      <Toolbar
        search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Company or reference…" className="w-full sm:w-64" label="Search payments" />}
        activeCount={activeCount}
        onClear={clear}
      >
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(PAYMENT_STATUS)} allLabel="Any status" />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        <EmptyState icon={activeCount ? SearchX : Receipt} title={activeCount ? 'No payments match' : 'No payments yet'} />
      ) : (
        <>
          <DataTable
            caption="Payments"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            mobileRow={(p) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.organization}</p>
                  <p className="text-xs text-ink-subtle">{p.plan} · {formatMoney(p.amountCents, p.currency)} · {formatDate(p.createdAt)}</p>
                </div>
                <StatusBadge map={PAYMENT_STATUS} value={p.status} />
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </>
      )}
    </>
  );
}

export function PlatformPlansPage() {
  useDocumentTitle('Plans');
  const { data, isLoading, error, refetch } = usePlatformQuery('/plans');
  const [editing, setEditing] = useState(null);
  const columns = [
    { key: 'name', header: 'Plan', className: 'w-auto', cell: (p) => <div><p className="font-medium">{p.name} {!p.isActive && <Badge>Hidden</Badge>}</p><p className="text-xs text-ink-subtle">{p.code}</p></div> },
    { key: 'price', header: 'Price / month', className: 'w-32 tabular-nums', cell: (p) => (p.priceCents ? formatMoney(p.priceCents, p.currency) : 'Free') },
    { key: 'users', header: 'Members', className: 'w-24', cell: (p) => formatLimit(p.maxUsers) },
    { key: 'projects', header: 'Projects', className: 'w-24', cell: (p) => formatLimit(p.maxProjects) },
    { key: 'branches', header: 'Branches', className: 'w-24', cell: (p) => formatLimit(p.maxBranches) },
    { key: 'features', header: 'Features', className: 'w-44', hideBelow: 'xl', cell: (p) => <span className="text-xs text-ink-muted">{p.features.map((f) => FEATURE_LABELS[f] ?? f).join(', ') || '—'}</span> },
    { key: 'subs', header: 'Companies', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (p) => <span className="tabular-nums">{p.subscribers}</span> },
    { key: 'edit', header: <span className="sr-only">Edit</span>, className: 'w-20 text-right', cell: (p) => <Button size="sm" icon={Pencil} onClick={() => setEditing(p)}>Edit</Button> },
  ];
  return (
    <>
      <PageHeader title="Plans" description="Monthly prices, limits and features. Changes apply to new checkouts; paid periods are honoured as purchased." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable
          caption="Plans"
          loading={isLoading}
          rows={data ?? []}
          columns={columns}
          mobileRow={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{p.name} · {p.priceCents ? formatMoney(p.priceCents, p.currency) : 'Free'}</p>
                <p className="text-xs text-ink-subtle">{formatLimit(p.maxUsers)} members · {formatLimit(p.maxProjects)} projects · {formatLimit(p.maxBranches)} branches</p>
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
      maxBranches: plan.maxBranches ?? '',
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

  const limit = (v) => (v === '' ? null : Number(v));
  const submit = (e) => {
    e.preventDefault();
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price (0 or more).');
    for (const [key, label] of [['maxUsers', 'Max members'], ['maxProjects', 'Max active projects'], ['maxBranches', 'Max branches']]) {
      const v = limit(draft[key]);
      if (v !== null && (!Number.isInteger(v) || v < 1)) return setError(`${label} must be a whole number of at least 1, or empty for unlimited.`);
    }
    save.mutate({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      priceCents: Math.round(price * 100),
      maxUsers: limit(draft.maxUsers),
      maxProjects: limit(draft.maxProjects),
      maxBranches: limit(draft.maxBranches),
      features: draft.features,
      isActive: draft.isActive,
    });
  };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const lowered = draft && plan && ['maxUsers', 'maxProjects', 'maxBranches'].some((k) => {
    const next = limit(draft[k]);
    return next !== null && (plan[k] === null || next < plan[k]);
  });

  return (
    <Modal open={!!plan} onOpenChange={(open) => !open && (setDraft(null), onClose())} title={`Edit ${plan?.name ?? ''} plan`}>
      {draft && (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <FormAlert>{error}</FormAlert>
            <p className="rounded-md bg-canvas px-3 py-2 text-xs text-ink-muted">
              {plan.subscribers} compan{plan.subscribers === 1 ? 'y uses' : 'ies use'} this plan. Prices apply to new checkouts only — paid periods and past payments never change. Limits apply immediately.
            </p>
            {lowered && (
              <p className="flex items-start gap-2 rounded-md border border-warning-600/20 bg-warning-50 px-3 py-2 text-xs text-warning-700" role="alert">
                <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
                You are lowering a limit. Companies already above it keep their data but cannot add more until they are under the limit or upgrade.
              </p>
            )}
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
              <Field label="Max active branches" hint="Includes the head office. Empty = unlimited">
                <Input type="number" min="1" inputMode="numeric" value={draft.maxBranches} onChange={set('maxBranches')} />
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
