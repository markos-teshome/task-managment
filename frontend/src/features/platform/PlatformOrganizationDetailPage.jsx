import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Ban, CheckCircle2, Lock, ScrollText } from 'lucide-react';
import { Section } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { ORG_STATUS, PAYMENT_STATUS, SUBSCRIPTION_STATUS } from '../../lib/status.js';
import { formatLimit, formatLongDate, formatMoney, relativeTime } from '../../lib/format.js';
import { describeAudit, OrganizationStatusDialog, StatStrip, usePlatformQuery } from './shared.jsx';

/**
 * One company, administrative view. Shows only what the platform API allows: identity, status, plan, billing,
 * renewal, counts and platform admin history. There is deliberately no way into the company's workspace.
 */
export function PlatformOrganizationDetailPage() {
  const { id } = useParams();
  const org = usePlatformQuery(`/organizations/${id}`);
  const history = usePlatformQuery('/audit-logs', { organizationId: id, pageSize: 20 });
  const [changing, setChanging] = useState(null); // target status
  useDocumentTitle(org.data?.name ?? 'Organization');

  const back = (
    <Link to="/platform/organizations" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-brand-700">
      <ArrowLeft size={14} aria-hidden="true" /> Organizations
    </Link>
  );
  if (org.error) {
    return (
      <>
        {back}
        <ErrorState error={org.error} title={org.error.status === 404 ? 'Organization not found' : undefined} onRetry={org.error.status === 404 ? undefined : org.refetch} />
      </>
    );
  }
  if (org.isLoading) {
    return (
      <div aria-busy="true">
        {back}
        <Skeleton className="mb-3 h-6 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const o = org.data;
  const sub = o.subscription;

  return (
    <>
      {back}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{o.name}</h1>
            <StatusBadge map={ORG_STATUS} value={o.status} />
            <Badge tone="brand">{o.plan?.name ?? 'No plan'}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">Registered {formatLongDate(o.createdAt)} · ID <code className="font-mono text-[11.5px]">{o.id}</code></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.closure?.requestedAt && o.status !== 'CLOSED' && (
            <Button variant="danger-ghost" icon={Ban} onClick={() => setChanging('CLOSED')}>Close organization</Button>
          )}
          {o.status === 'ACTIVE' ? (
            <Button variant="danger-ghost" icon={Ban} onClick={() => setChanging('SUSPENDED')}>Suspend</Button>
          ) : (
            <Button icon={CheckCircle2} onClick={() => setChanging('ACTIVE')}>{o.status === 'CLOSED' ? 'Reopen' : 'Reactivate'}</Button>
          )}
        </div>
      </header>

      {o.closure && (
        <p className="mb-4 rounded-md border border-line bg-warning-50 px-3 py-2 text-[13px] text-warning-700">
          {o.status === 'CLOSED'
            ? `Closed ${formatLongDate(o.closure.closedAt)}. Data is kept; reopening restores access.`
            : `The owner requested closure on ${formatLongDate(o.closure.requestedAt)}. The subscription won't renew.`}
          {o.closure.reason && ` Reason: “${o.closure.reason}”.`}
        </p>
      )}

      <StatStrip
        className="mb-6"
        items={[
          { label: 'Active members', value: o.activeMembers, sub: sub ? `limit ${formatLimit(sub.limits.maxUsers)}` : undefined },
          { label: 'Active branches', value: o.activeBranches, sub: sub ? `limit ${formatLimit(sub.limits.maxBranches)}` : undefined },
          { label: 'Paid to date', value: formatMoney(o.payments.totalPaidCents), sub: `${o.payments.succeeded} payments` },
          { label: 'Failed payments', value: o.payments.failed, tone: 'warning' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Subscription" id="org-subscription">
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
            <Row label="Plan">{o.plan?.name ?? '—'}</Row>
            <Row label="Billing status">{sub ? <StatusBadge map={SUBSCRIPTION_STATUS} value={sub.status} /> : '—'}</Row>
            <Row label="Current period">{sub ? `${formatLongDate(sub.currentPeriodStart)} – ${sub.currentPeriodEnd ? formatLongDate(sub.currentPeriodEnd) : 'no end (Free)'}` : '—'}</Row>
            <Row label="Renewal">{sub?.currentPeriodEnd ? (sub.cancelAtPeriodEnd ? `Ends ${formatLongDate(sub.currentPeriodEnd)} (cancelled)` : `Renews ${formatLongDate(sub.currentPeriodEnd)}`) : '—'}</Row>
            <Row label="Project limit">{sub ? formatLimit(sub.limits.maxProjects) : '—'}</Row>
            <Row label="Last payment">
              {o.payments.last ? (
                <span className="inline-flex items-center gap-2">
                  {formatMoney(o.payments.last.amountCents, o.payments.last.currency)} · {formatLongDate(o.payments.last.createdAt)}
                  <StatusBadge map={PAYMENT_STATUS} value={o.payments.last.status} />
                </span>
              ) : (
                'None'
              )}
            </Row>
          </dl>
        </Section>

        <Section title="Billing contacts" id="org-contacts">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-[13px]">
            {o.billingContacts.map((c) => (
              <li key={c.email} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-medium">{c.name}</span>
                <a href={`mailto:${c.email}`} className="truncate text-brand-700 hover:underline">{c.email}</a>
              </li>
            ))}
            {!o.billingContacts.length && <li className="px-3 py-2 text-ink-muted">No active owner.</li>}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-subtle">
            <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            Projects, tasks, files and the company's own activity are private to the company and are not available in the platform console.
          </p>
        </Section>
      </div>

      <Section title="Platform admin history" id="org-history" className="mt-6">
        {history.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !history.data?.items.length ? (
          <div className="rounded-lg border border-line bg-surface"><EmptyState compact icon={ScrollText} title="No admin actions for this company" /></div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {history.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-[13px]">
                <span className="font-medium">{a.actor?.name ?? 'Command line'}</span>
                <span className="text-ink-muted">{describeAudit(a)}</span>
                <span className="ml-auto text-xs text-ink-subtle" title={new Date(a.createdAt).toLocaleString()}>{relativeTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <OrganizationStatusDialog org={changing ? o : null} target={changing} onClose={() => setChanging(null)} />
    </>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}
