import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useRefreshEntitlements } from './api.js';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatLimit, formatLongDate, formatMoney, formatTime } from '../../lib/format.js';
import { useAuth } from '../auth/AuthProvider.jsx';

// Seconds to wait before each re-check: quick at first, then backing off (~40 s in total).
const SCHEDULE = [2, 2, 3, 3, 5, 5, 8, 10];
// "Can't tell right now" — never a reason to show the payment as failed.
const TRANSIENT = ['PAYMENT_VERIFICATION_UNAVAILABLE', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'TIMEOUT'];
const FINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'];

/**
 * Where Chapa sends the customer back. Every state shown comes from the server: the page asks the API
 * to verify the payment with Chapa, re-checks on a bounded schedule while it is pending, and stops on a
 * final state or after the schedule with a recoverable "still confirming" screen. Refreshing the page or
 * coming back later simply starts again from the server's answer.
 */
export function PaymentReturnPage({ billingPath = '/billing' }) {
  useDocumentTitle('Payment status');
  const [params] = useSearchParams();
  const txRef = params.get('tx_ref');
  const refreshEntitlements = useRefreshEntitlements();
  const [state, setState] = useState({ phase: 'verifying', payment: null, error: null });
  const [run, setRun] = useState(0);
  const refreshed = useRef(false);

  const restart = useCallback(() => {
    setState((s) => ({ ...s, phase: 'verifying', error: null }));
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!txRef) return undefined;
    let cancelled = false;
    let timer;
    const check = async (attempt) => {
      let payment = null;
      let error = null;
      try {
        payment = await api.post(`/payments/${encodeURIComponent(txRef)}/verify`);
      } catch (err) {
        error = err;
      }
      if (cancelled) return;

      if (error && !TRANSIENT.includes(error.code)) {
        setState({ phase: 'error', payment: null, error }); // e.g. unknown reference
        return;
      }
      if (payment && FINAL.includes(payment.status)) {
        setState({ phase: 'done', payment, error: null });
        if (payment.status === 'SUCCEEDED' && !refreshed.current) {
          refreshed.current = true;
          refreshEntitlements(); // new limits, billing, dashboard and activity
        }
        return;
      }
      // Still pending, or the provider couldn't be reached this time.
      if (attempt < SCHEDULE.length) {
        setState((s) => ({ phase: 'verifying', payment: payment ?? s.payment, error }));
        timer = setTimeout(() => check(attempt + 1), SCHEDULE[attempt] * 1000);
      } else {
        setState((s) => ({ phase: 'waiting', payment: payment ?? s.payment, error }));
      }
    };
    check(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // refreshEntitlements is recreated each render; the effect must only restart on a new reference or retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRef, run]);

  const p = state.payment;
  let view;
  if (!txRef) {
    view = <Result icon={XCircle} tone="danger" title="Missing payment reference" body="We couldn't tell which payment this is. Open Plan & billing to see your payments." />;
  } else if (state.phase === 'error') {
    view = (
      <Result icon={XCircle} tone="danger" title="We couldn't find this payment" body={state.error.message}>
        <Button onClick={restart}>Try again</Button>
      </Result>
    );
  } else if (state.phase === 'verifying') {
    view = <Verifying />;
  } else if (state.phase === 'waiting') {
    view = (
      <Result
        icon={Clock}
        tone="warning"
        title="Your payment is still being confirmed"
        body="Please check your payment status. Confirmation can take a little longer; your plan changes as soon as the payment provider confirms it, and you won't be charged twice."
      >
        <Button variant="primary" onClick={restart}>Check status</Button>
      </Result>
    );
  } else if (p.status === 'SUCCEEDED') {
    view = (
      <Result
        icon={CheckCircle2}
        tone="success"
        title={`You're on ${p.plan.name}`}
        body={
          billingPath === '/billing'
            ? 'Payment confirmed. Your new limits are available now.'
            : 'Payment confirmed. Your organization stays suspended until TeamFlow support reviews it and restores access.'
        }
      >
        <Receipt payment={p} />
        <PlanLimits code={p.plan.code} />
        {billingPath === '/billing' && <ButtonLink to="/team" variant="primary">Invite your team</ButtonLink>}
      </Result>
    );
  } else if (p.status === 'FAILED') {
    view = (
      <Result icon={XCircle} tone="danger" title="Payment failed" body={`${p.failureReason ?? 'The payment did not go through.'} Your plan has not changed.`}>
        <ButtonLink to={`${billingPath}#plans`} variant="primary">Try again</ButtonLink>
      </Result>
    );
  } else if (p.status === 'EXPIRED') {
    view = (
      <Result icon={Clock} tone="neutral" title="Checkout expired" body="This checkout was not completed in time and your plan has not changed. If you did pay, it is confirmed automatically as soon as the provider reports it.">
        <Button onClick={restart}>Check again</Button>
        <ButtonLink to={`${billingPath}#plans`} variant="primary">Start a new checkout</ButtonLink>
      </Result>
    );
  } else {
    view = (
      <Result icon={XCircle} tone="neutral" title="Payment cancelled" body={`${p.failureReason ?? 'The checkout was cancelled.'} No payment was taken and your plan has not changed.`}>
        <ButtonLink to={`${billingPath}#plans`} variant="primary">Choose a plan</ButtonLink>
      </Result>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10" aria-live="polite">
      {view}
      <p className="mt-8 text-center">
        <Link to={billingPath} className="text-[13px] font-medium text-brand-700 hover:underline">
          Back to plan & billing
        </Link>
      </p>
    </div>
  );
}

/** Restrained verification indicator: a ring that fills in brand colours around a shield — never a checkmark. */
function Verifying() {
  return (
    <div className="flex flex-col items-center text-center" role="status">
      <span className="relative inline-flex h-12 w-12 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-brand-100" aria-hidden="true" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brand-700 [animation-duration:1.1s]" aria-hidden="true" />
        <ShieldCheck size={20} className="text-brand-700" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Verifying your payment…</h1>
      <p className="mt-1 text-[13px] text-ink-muted">We're confirming it with the payment provider. This can take a moment — you can stay on this page.</p>
    </div>
  );
}

function Receipt({ payment: p }) {
  const rows = [
    ['Plan', p.plan.name],
    ['Amount', formatMoney(p.amountCents, p.currency)],
    ['Confirmed', p.confirmedAt ? `${formatLongDate(p.confirmedAt)}, ${formatTime(p.confirmedAt)}` : '—'],
    ['Reference', p.txRef],
  ];
  return (
    <dl className="w-full divide-y divide-line rounded-md border border-line text-left text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="text-ink-muted">{label}</dt>
          <dd className={label === 'Reference' ? 'truncate font-mono text-[11.5px]' : 'font-medium tabular-nums'}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanLimits({ code }) {
  const { workspace } = useAuth();
  if (workspace?.plan.code !== code) return null;
  return (
    <p className="text-[13px] text-ink-muted">
      Now: {formatLimit(workspace.plan.maxUsers)} members · {formatLimit(workspace.plan.maxProjects)} projects
    </p>
  );
}

function Result({ icon: Icon, tone, title, body, children }) {
  const tones = { success: 'bg-success-50 text-success-600', danger: 'bg-danger-50 text-danger-600', warning: 'bg-warning-50 text-warning-600', neutral: 'bg-slate-100 text-ink-muted' };
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}>
        <Icon size={24} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-[13px] text-ink-muted">{body}</p>
      {children && <div className="mt-5 flex w-full flex-col items-center gap-3">{children}</div>}
    </div>
  );
}
