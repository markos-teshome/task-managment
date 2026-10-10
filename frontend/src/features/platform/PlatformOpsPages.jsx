import { CheckCircle2, ScrollText, XCircle } from 'lucide-react';
import { PageHeader, Section, Toolbar } from '../../components/layout/PageHeader.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { FilterSelect, Pagination, Skeleton } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatLongDate, formatTime, relativeTime } from '../../lib/format.js';
import { AUDIT_LABELS, describeAudit, StatStrip, usePlatformQuery } from './shared.jsx';

/** Everything platform admins did: sign-ins, suspensions (with reason), plan changes, admin management. */
export function PlatformActivityPage() {
  useDocumentTitle('Admin activity');
  const { filters, setFilters, clear, activeCount } = useUrlFilters(['action', 'page']);
  const { data, isLoading, error, refetch } = usePlatformQuery('/audit-logs', { ...filters, pageSize: 30 });
  const columns = [
    { key: 'when', header: 'When', className: 'w-40', cell: (a) => <span className="text-ink-muted" title={new Date(a.createdAt).toLocaleString()}>{formatLongDate(a.createdAt)}, {formatTime(a.createdAt)}</span> },
    { key: 'who', header: 'Admin', className: 'w-44', cell: (a) => <span className="truncate font-medium">{a.actor?.name ?? 'Command line'}</span> },
    { key: 'what', header: 'Action', className: 'w-auto', cell: (a) => <span className="block truncate" title={describeAudit(a)}>{describeAudit(a)}</span> },
    { key: 'ip', header: 'IP', className: 'w-32', hideBelow: 'xl', cell: (a) => <code className="font-mono text-[11.5px] text-ink-subtle">{a.ipAddress ?? '—'}</code> },
  ];
  return (
    <>
      <PageHeader title="Admin activity" description="An append-only record of every platform administrator action." />
      <Toolbar activeCount={activeCount} onClear={clear}>
        <FilterSelect label="Action" value={filters.action} onChange={(action) => setFilters({ action })} options={Object.entries(AUDIT_LABELS).map(([value, label]) => ({ value, label }))} allLabel="All actions" />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No admin actions recorded" />
      ) : (
        <>
          <DataTable
            caption="Platform admin activity"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            mobileRow={(a) => (
              <div>
                <p className="text-[13px]"><span className="font-medium">{a.actor?.name ?? 'Command line'}</span> <span className="text-ink-muted">{describeAudit(a)}</span></p>
                <p className="text-xs text-ink-subtle">{relativeTime(a.createdAt)}</p>
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </>
      )}
    </>
  );
}

/** Operational health from the API: dependencies and recent problems (never tenant data). */
export function PlatformHealthPage() {
  useDocumentTitle('System health');
  const { data, isLoading, error, refetch, dataUpdatedAt } = usePlatformQuery('/health', undefined, { refetchInterval: 60_000 });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader title="System health" description={`Live status of TeamFlow's services${dataUpdatedAt ? ` · checked ${relativeTime(new Date(dataUpdatedAt).toISOString())}` : ''}.`} />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <StatStrip
            className="mb-6"
            items={[
              { label: 'Database', value: `${data.database.latencyMs} ms`, sub: 'Query round-trip' },
              { label: 'Payments', value: data.payments.mode, sub: `Chapa · ${data.payments.failedLast24h} failed (24 h)`, tone: data.payments.failedLast24h ? 'warning' : undefined },
              { label: 'Stale checkouts', value: data.payments.pendingOlderThan1h, sub: 'Pending over 1 hour', tone: 'warning' },
              { label: 'Server errors', value: data.errors.total, sub: `since ${formatLongDate(data.errors.since)}`, tone: 'danger' },
            ]}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Checks" id="health-checks">
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
                <Check ok={data.database.ok} label="Database reachable" />
                <Check ok={data.email.lastCheck.verified !== false} label={data.email.lastCheck.verified === null ? 'Email: not checked since start-up' : 'Email (SMTP) sign-in at start-up'} />
                <Check ok={data.payments.webhookSecretConfigured} label="Chapa webhook secret configured" />
                <Check ok={data.payments.mode === 'TEST'} label={data.payments.mode === 'TEST' ? 'Chapa in test mode (no real money)' : 'Chapa LIVE mode'} neutral />
              </ul>
            </Section>
            <Section title="Recent server errors" id="health-errors">
              {data.errors.recent.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-ink-muted">
                  <CheckCircle2 size={16} className="text-success-600" aria-hidden="true" /> No unexpected errors since the server started.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
                  {data.errors.recent.slice(0, 10).map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <code className="font-mono text-[11.5px]">{e.method} {e.route}</code>
                      <span className="text-xs text-ink-subtle">{e.type}</span>
                      <span className="ml-auto text-xs text-ink-subtle">{relativeTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-subtle">Only the route and error type are kept here; full details are in the server log.</p>
            </Section>
          </div>
        </>
      )}
    </>
  );
}

function Check({ ok, label, neutral }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <Icon size={15} className={ok ? 'text-success-600' : neutral ? 'text-warning-600' : 'text-danger-600'} aria-hidden="true" />
      {label}
    </li>
  );
}
