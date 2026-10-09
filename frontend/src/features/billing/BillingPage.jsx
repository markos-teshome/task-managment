import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AlertTriangle, Check, CreditCard, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useCheckout, usePayments, useSubscription, useSubscriptionAction } from './api.js';
import { PageHeader, Section } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { UsageMeter } from '../../components/ui/Progress.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Pagination, Skeleton } from '../../components/ui/Misc.jsx';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { FormAlert } from '../../components/ui/Form.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { FEATURE_LABELS, PAYMENT_STATUS, SUBSCRIPTION_STATUS } from '../../lib/status.js';
import { formatLimit, formatLongDate, formatMoney } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

export function BillingPage() {
  useDocumentTitle('Plan & billing');
  const { can } = useAuth();
  const subscription = useSubscription();
  const location = useLocation();
  const [reviewing, setReviewing] = useState(null);
  const canBuy = can('SUBSCRIPTION_MANAGE', 'BILLING_MANAGE');

  useEffect(() => {
    if (location.hash === '#plans' && subscription.data) document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, subscription.data]);

  return (
    <>
      <PageHeader title="Plan & billing" description="Your subscription, usage and payment history." />
      {can('SUBSCRIPTION_VIEW') &&
        (subscription.error ? (
          <ErrorState error={subscription.error} onRetry={subscription.refetch} />
        ) : subscription.isLoading ? (
          <Skeleton className="mb-6 h-40 w-full" />
        ) : (
          <>
            <CurrentPlan data={subscription.data} />
            <Section title="Plans" id="plans" className="mb-8 scroll-mt-20">
              <PlanComparison data={subscription.data} canBuy={canBuy} onChoose={setReviewing} />
            </Section>
          </>
        ))}
      {can('BILLING_VIEW') && <PaymentHistory />}
      <ReviewModal plan={reviewing} current={subscription.data} onClose={() => setReviewing(null)} />
    </>
  );
}

function CurrentPlan({ data }) {
  const { can } = useAuth();
  const action = useSubscriptionAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { plan, usage, subscription: sub, isFallback } = data;
  const paid = sub && sub.currentPeriodEnd && !isFallback;

  return (
    <section aria-labelledby="current-plan" className="mb-8 grid gap-4 rounded-lg border border-line bg-surface p-4 md:grid-cols-[1fr_1fr_auto] md:items-center">
      <div>
        <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">Your plan</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h2 id="current-plan" className="text-xl font-semibold">{plan.name}</h2>
          {sub && <StatusBadge map={SUBSCRIPTION_STATUS} value={isFallback && sub.status === 'ACTIVE' ? 'EXPIRED' : sub.status} />}
          {sub?.cancelAtPeriodEnd && !isFallback && <Badge tone="warning">Cancels at period end</Badge>}
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {isFallback && sub?.currentPeriodEnd
            ? `Your ${sub.planName} subscription ended ${formatLongDate(sub.currentPeriodEnd)}. Free plan limits apply until you renew.`
            : paid
              ? `${sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on ${formatLongDate(sub.currentPeriodEnd)}`
              : 'Free forever. Upgrade any time for more people and projects.'}
        </p>
        {plan.features.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {plan.features.map((f) => (
              <li key={f}>
                <Badge tone="brand" icon={Check}>{FEATURE_LABELS[f] ?? f}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        <UsageMeter label="Team members" used={usage.users} limit={plan.maxUsers} />
        <UsageMeter label="Active projects" used={usage.projects} limit={plan.maxProjects} />
      </div>
      {paid && can('SUBSCRIPTION_MANAGE') && (
        <div className="md:justify-self-end">
          {sub.cancelAtPeriodEnd ? (
            <Button loading={action.isPending} onClick={() => action.mutate('resume', { onSuccess: () => toast.success('Subscription resumed'), onError: (e) => toast.error(e.message) })}>
              Resume subscription
            </Button>
          ) : (
            <Button variant="danger-ghost" onClick={() => setConfirmCancel(true)}>
              Cancel subscription
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel subscription?"
        description={`You keep ${plan.name} until ${paid ? formatLongDate(sub.currentPeriodEnd) : 'the end of the period'}. After that, Free plan limits apply — nothing is deleted, but you won't be able to add people or projects above the limits.`}
        confirmLabel="Cancel subscription"
        loading={action.isPending}
        onConfirm={() =>
          action.mutate('cancel', {
            onSuccess: () => {
              toast.success('Subscription will end at the end of the period');
              setConfirmCancel(false);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </section>
  );
}

function PlanComparison({ data, canBuy, onChoose }) {
  const currentCode = data.plan.code;
  const paidLive = data.subscription?.currentPeriodEnd && !data.isFallback;
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-3">
        {data.plans.map((p) => {
          const current = p.code === currentCode;
          const free = p.priceCents === 0;
          let cta = null;
          if (canBuy && !free) {
            cta = (
              <Button variant={current ? 'secondary' : 'primary'} className="w-full" onClick={() => onChoose(p)}>
                {current ? 'Renew for another month' : p.priceCents > (data.plans.find((x) => x.code === currentCode)?.priceCents ?? 0) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
              </Button>
            );
          }
          return (
            <li
              key={p.id}
              className={cn('relative flex flex-col rounded-lg border bg-surface p-4', current ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line')}
            >
              {current && (
                <span className="absolute -top-2.5 left-4 rounded bg-accent-500 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-900">
                  Current plan
                </span>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold">{p.name}</h3>
                <p className="text-right">
                  <span className="text-lg font-semibold tabular-nums">{formatMoney(p.priceCents, p.currency)}</span>
                  <span className="text-xs text-ink-subtle"> /month</span>
                </p>
              </div>
              {p.description && <p className="mt-1 text-[13px] text-ink-muted">{p.description}</p>}
              <ul className="mt-3 flex-1 space-y-1.5 text-[13px]">
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" />{formatLimit(p.maxUsers)} team members</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" />{formatLimit(p.maxProjects)} active projects</li>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" />{FEATURE_LABELS[f] ?? f}</li>
                ))}
              </ul>
              <div className="mt-4">
                {cta ??
                  (current ? (
                    <p className="text-center text-xs text-ink-subtle">You're on this plan</p>
                  ) : free && paidLive ? (
                    <p className="text-center text-xs text-ink-subtle">Cancel your subscription to return to Free at period end</p>
                  ) : !canBuy ? (
                    <p className="text-center text-xs text-ink-subtle">Ask an owner to change the plan</p>
                  ) : null)}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-subtle">Prices in {data.plans[0]?.currency ?? 'ETB'}, billed monthly. Paying for a different plan starts a new 30-day period immediately.</p>
    </>
  );
}

/** Step 2 of the upgrade: confirm what changes, then hand over to the payment provider. */
function ReviewModal({ plan, current, onClose }) {
  const checkout = useCheckout();
  const [error, setError] = useState(null);
  useEffect(() => setError(null), [plan]);
  if (!current) return null;

  const pay = () =>
    checkout.mutate(plan.id, {
      // Hand over to Chapa's hosted checkout; Chapa returns the customer to /billing/return.
      onSuccess: (payment) => window.location.assign(payment.checkoutUrl),
      onError: (err) => setError(err.message),
    });

  const rows = plan && [
    ['Team members', formatLimit(current.plan.maxUsers), formatLimit(plan.maxUsers)],
    ['Active projects', formatLimit(current.plan.maxProjects), formatLimit(plan.maxProjects)],
  ];

  return (
    <Modal open={!!plan} onOpenChange={(open) => !open && onClose()} title="Review your plan change" size="md">
      {plan && (
        <>
          <DialogBody className="space-y-4">
            <FormAlert>{error}</FormAlert>
            <div className="flex items-baseline justify-between rounded-md bg-canvas px-3 py-2.5">
              <span className="text-[13px]">
                <span className="font-semibold">{plan.name}</span> · monthly
              </span>
              <span className="text-lg font-semibold tabular-nums">{formatMoney(plan.priceCents, plan.currency)}</span>
            </div>
            <table className="w-full text-[13px]">
              <caption className="sr-only">Limits before and after</caption>
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="pb-1 font-medium">Limit</th>
                  <th className="pb-1 font-medium">Now ({current.plan.name})</th>
                  <th className="pb-1 font-medium">With {plan.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(([label, now, next]) => (
                  <tr key={label}>
                    <td className="py-1.5 text-ink-muted">{label}</td>
                    <td className="py-1.5 tabular-nums">{now}</td>
                    <td className="py-1.5 font-medium tabular-nums">{next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-ink-muted">
              You'll be taken to a secure payment page. Your plan changes only after the payment provider confirms the payment.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" icon={CreditCard} loading={checkout.isPending} onClick={pay}>
              Continue to payment
            </Button>
          </DialogFooter>
        </>
      )}
    </Modal>
  );
}

function PaymentHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = usePayments({ page, pageSize: 10 });
  const navigate = useNavigate();
  const pending = data?.items.find((p) => p.status === 'PENDING');

  const columns = [
    { key: 'date', header: 'Date', className: 'w-36', cell: (p) => formatLongDate(p.createdAt) },
    { key: 'plan', header: 'Plan', className: 'w-auto', cell: (p) => <span className="font-medium">{p.plan.name}</span> },
    { key: 'amount', header: 'Amount', className: 'w-32 tabular-nums', cell: (p) => formatMoney(p.amountCents, p.currency) },
    { key: 'status', header: 'Status', className: 'w-28', cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
    { key: 'by', header: 'By', className: 'w-36', hideBelow: 'lg', cell: (p) => <span className="text-ink-muted">{p.initiatedBy ?? '—'}</span> },
    { key: 'ref', header: 'Reference', className: 'w-56', hideBelow: 'xl', cell: (p) => <code className="truncate font-mono text-[11.5px] text-ink-subtle">{p.txRef}</code> },
  ];

  return (
    <Section title="Payment history" id="payments">
      {pending && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-600/20 bg-warning-50 px-3 py-2 text-[13px] text-warning-700">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} aria-hidden="true" /> A payment for {pending.plan.name} is waiting for confirmation.
          </span>
          <Button size="sm" onClick={() => navigate(`/billing/return?tx_ref=${pending.txRef}`)}>
            Check status
          </Button>
        </div>
      )}
      {error ? (
        <ErrorState error={error} onRetry={refetch} compact />
      ) : !isLoading && data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState compact icon={Receipt} title="No payments yet" description="Payments for plan upgrades will appear here." />
        </div>
      ) : (
        <>
          <DataTable
            caption="Payments"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            skeletonRows={3}
            mobileRow={(p) => (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-medium">{p.plan.name} · {formatMoney(p.amountCents, p.currency)}</p>
                  <p className="text-xs text-ink-subtle">{formatLongDate(p.createdAt)}</p>
                </div>
                <StatusBadge map={PAYMENT_STATUS} value={p.status} />
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
        </>
      )}
    </Section>
  );
}
