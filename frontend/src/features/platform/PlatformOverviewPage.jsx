import { Link } from 'react-router';
import { AlertTriangle, Building2, CheckCircle2, ScrollText } from 'lucide-react';
import { PageHeader, Section } from '../../components/layout/PageHeader.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { ORG_STATUS } from '../../lib/status.js';
import { formatDate, formatMoney, relativeTime } from '../../lib/format.js';
import { describeAudit, StatStrip, usePlatformQuery } from './shared.jsx';

/** The SaaS business at a glance: companies, subscriptions, payments and recent admin work. */
export function PlatformOverviewPage() {
  useDocumentTitle('Platform overview');
  const overview = usePlatformQuery('/overview');
  const recent = usePlatformQuery('/organizations', { pageSize: 6 });
  const suspended = usePlatformQuery('/organizations', { status: 'SUSPENDED', pageSize: 5 });
  const ending = usePlatformQuery('/subscriptions', { endingWithinDays: 7, pageSize: 5 });
  // Sign-ins are routine; the overview shows actions that changed something (full log: Admin activity).
  const audit = usePlatformQuery('/audit-logs', { pageSize: 30 });
  const changes = audit.data?.items.filter((a) => a.action !== 'PLATFORM_SIGNED_IN').slice(0, 6);

  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.refetch} />;
  const d = overview.data;

  return (
    <>
      <PageHeader title="Platform overview" description="TeamFlow as a business: companies, subscriptions and payments." />
      {overview.isLoading ? (
        <Skeleton className="mb-6 h-[74px] w-full" />
      ) : (
        <StatStrip
          className="mb-6"
          items={[
            { label: 'Companies', value: d.organizations, sub: `${d.activeOrganizations} active`, to: '/platform/organizations' },
            { label: 'Suspended', value: d.suspended, sub: d.suspended ? 'Access blocked' : 'None', tone: 'warning', to: '/platform/organizations?status=SUSPENDED' },
            { label: 'Paid subscriptions', value: d.activePaidSubscriptions, sub: `${d.subscriptionsEndingWithin7Days} end within 7 days`, to: '/platform/subscriptions' },
            { label: 'Payments', value: d.pendingPayments, sub: `pending · ${d.failedPaymentsLast30Days} failed (30 days)`, tone: 'warning', to: '/platform/payments' },
            ...d.revenue.map((r) => ({ label: `Revenue (${r.currency})`, value: formatMoney(r.amountCents, r.currency), sub: `${r.payments} confirmed payments` })),
          ]}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Section title="Recently registered" id="recent-orgs" action={<Link to="/platform/organizations" className="text-xs font-medium text-brand-700 hover:underline">All companies</Link>}>
            {recent.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !recent.data?.items.length ? (
              <div className="rounded-lg border border-line bg-surface"><EmptyState compact icon={Building2} title="No companies yet" /></div>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {recent.data.items.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <Link to={`/platform/organizations/${o.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand-700 hover:underline">{o.name}</Link>
                    <Badge tone="brand">{o.plan?.name ?? '—'}</Badge>
                    <span className="hidden w-20 text-right text-xs text-ink-subtle sm:inline">{formatDate(o.createdAt)}</span>
                    <StatusBadge map={ORG_STATUS} value={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Needs attention" id="attention">
            <Attention suspended={suspended.data?.items} ending={ending.data?.items} loading={suspended.isLoading || ending.isLoading} />
          </Section>
        </div>

        <div className="min-w-0 space-y-6">
          <Section title="Companies by plan" id="by-plan">
            {overview.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {d.organizationsByPlan.map((p) => (
                  <li key={p.code} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="flex-1">{p.name}</span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                      <span className="block h-full rounded-full bg-brand-600" style={{ width: `${d.organizations ? (p.count / d.organizations) * 100 : 0}%` }} />
                    </span>
                    <span className="w-6 text-right font-medium tabular-nums">{p.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent admin actions" id="audit" action={<Link to="/platform/activity" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>}>
            {audit.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !changes?.length ? (
              <div className="rounded-lg border border-line bg-surface"><EmptyState compact icon={ScrollText} title="No admin actions yet" /></div>
            ) : (
              <ul className="space-y-2 rounded-lg border border-line bg-surface px-3 py-2.5">
                {changes.map((a) => (
                  <li key={a.id} className="text-[13px] leading-snug">
                    <span className="font-medium">{a.actor?.name ?? 'Command line'}</span> <span className="text-ink-muted">{describeAudit(a)}</span>
                    <span className="ml-1 text-xs text-ink-subtle">{relativeTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Attention({ suspended = [], ending = [], loading }) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  const rows = [
    ...suspended.map((o) => ({ key: `s-${o.id}`, id: o.id, name: o.name, note: 'Suspended', tone: 'danger' })),
    ...ending.map((s) => ({
      key: `e-${s.organization.id}`,
      id: s.organization.id,
      name: s.organization.name,
      note: `${s.plan.name} ${s.cancelAtPeriodEnd ? 'cancels' : 'renews'} ${formatDate(s.currentPeriodEnd)}`,
      tone: 'warning',
    })),
  ];
  if (!rows.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-ink-muted">
        <CheckCircle2 size={16} className="text-success-600" aria-hidden="true" /> Nothing needs attention: no suspended companies or subscriptions ending this week.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 px-3 py-2 text-[13px]">
          <AlertTriangle size={14} className={r.tone === 'danger' ? 'text-danger-600' : 'text-warning-600'} aria-hidden="true" />
          <Link to={`/platform/organizations/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand-700 hover:underline">{r.name}</Link>
          <span className="text-xs text-ink-muted">{r.note}</span>
        </li>
      ))}
    </ul>
  );
}
