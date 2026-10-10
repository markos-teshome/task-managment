import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useRefreshEntitlements } from './api.js';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatLimit, formatMoney } from '../../lib/format.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const MAX_CHECKS = 10;

/**
 * Where the provider sends the customer back. Shows "processing" until the backend confirms
 * the final status — success is only ever displayed from the server's answer.
 */
export function PaymentReturnPage() {
  useDocumentTitle('Payment status');
  const [params] = useSearchParams();
  const txRef = params.get('tx_ref');
  const refreshEntitlements = useRefreshEntitlements();
  const [state, setState] = useState({ phase: 'checking', payment: null, error: null, checks: 0 });
  const refreshed = useRef(false);

  useEffect(() => {
    if (!txRef) return undefined;
    let cancelled = false;
    let timer;
    const check = async (attempt) => {
      try {
        const payment = await api.post(`/payments/${txRef}/verify`);
        if (cancelled) return;
        if (payment.status === 'PENDING' && attempt < MAX_CHECKS) {
          setState({ phase: 'checking', payment, error: null, checks: attempt });
          timer = setTimeout(() => check(attempt + 1), 2000);
        } else {
          setState({ phase: payment.status === 'PENDING' ? 'waiting' : 'done', payment, error: null, checks: attempt });
          if (payment.status === 'SUCCEEDED' && !refreshed.current) {
            refreshed.current = true;
            refreshEntitlements();
          }
        }
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, phase: 'error', error }));
      }
    };
    check(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRef, state.retry]);

  const retry = () => setState((s) => ({ ...s, phase: 'checking', error: null, retry: (s.retry ?? 0) + 1 }));
  const p = state.payment;

  let view;
  if (!txRef) {
    view = <Result icon={XCircle} tone="danger" title="Missing payment reference" body="We couldn't tell which payment this is." />;
  } else if (state.phase === 'error') {
    view = (
      <Result icon={XCircle} tone="danger" title="We couldn't check your payment" body={state.error.code === 'NETWORK_ERROR' ? 'Your connection dropped. Your payment is safe — check again in a moment.' : state.error.message}>
        <Button onClick={retry}>Check again</Button>
      </Result>
    );
  } else if (state.phase === 'checking') {
    view = (
      <div className="flex flex-col items-center text-center">
        <Spinner size={28} />
        <h1 className="mt-4 text-lg font-semibold">Processing payment…</h1>
        <p className="mt-1 text-[13px] text-ink-muted">We're confirming your payment with the provider. This usually takes a few seconds — please don't close this page.</p>
      </div>
    );
  } else if (state.phase === 'waiting') {
    view = (
      <Result icon={Clock} tone="warning" title="Still waiting for confirmation" body="The provider hasn't confirmed this payment yet. Nothing has been charged twice; your plan changes as soon as it's confirmed.">
        <Button onClick={retry}>Check again</Button>
      </Result>
    );
  } else if (p.status === 'SUCCEEDED') {
    view = (
      <Result icon={CheckCircle2} tone="success" title={`You're on ${p.plan.name}`} body={`Payment of ${formatMoney(p.amountCents, p.currency)} confirmed. Your new limits are available now.`}>
        <PlanLimits code={p.plan.code} />
        <ButtonLink to="/team" variant="primary">Invite your team</ButtonLink>
      </Result>
    );
  } else if (p.status === 'FAILED') {
    view = (
      <Result icon={XCircle} tone="danger" title="Payment failed" body={`${p.failureReason ?? 'The payment did not go through.'} You have not been charged and your plan has not changed.`}>
        <ButtonLink to="/billing#plans" variant="primary">Try again</ButtonLink>
      </Result>
    );
  } else if (p.status === 'EXPIRED') {
    view = (
      <Result icon={Clock} tone="neutral" title="Checkout expired" body="This checkout was not completed in time and your plan has not changed. If you did pay, it is confirmed automatically as soon as the provider reports it.">
        <Button onClick={retry}>Check again</Button>
        <ButtonLink to="/billing#plans" variant="primary">Start a new checkout</ButtonLink>
      </Result>
    );
  } else {
    view = (
      <Result icon={XCircle} tone="neutral" title="Payment cancelled" body={`${p.failureReason ?? 'The checkout was cancelled.'} No payment was taken and your plan has not changed.`}>
        <ButtonLink to="/billing#plans" variant="primary">Choose a plan</ButtonLink>
      </Result>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10" aria-live="polite">
      {view}
      <p className="mt-8 text-center">
        <Link to="/billing" className="text-[13px] font-medium text-brand-700 hover:underline">
          Back to plan & billing
        </Link>
      </p>
    </div>
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
      {children && <div className="mt-5 flex flex-col items-center gap-3">{children}</div>}
    </div>
  );
}
