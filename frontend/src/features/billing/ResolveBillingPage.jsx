import { useState } from 'react';
import { Navigate } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useSubscription } from './api.js';
import { CurrentPlan, PaymentHistory, PlanComparison, ReviewModal } from './BillingPage.jsx';
import { PaymentReturnPage } from './PaymentReturnPage.jsx';
import { PageHeader, Section } from '../../components/layout/PageHeader.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

/**
 * D-13: a suspended organization's billing holder can see the subscription, pay and check payments —
 * nothing else. Paying doesn't lift the suspension; TeamFlow support reviews and reactivates.
 */
function useBillingResolution() {
  const { me } = useAuth();
  return me?.blockedWorkspace?.canResolveBilling ? me.blockedWorkspace : null;
}

function Frame({ children }) {
  return <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</div>;
}

export function ResolveBillingPage() {
  useDocumentTitle('Resolve billing');
  const blocked = useBillingResolution();
  const subscription = useSubscription();
  const [reviewing, setReviewing] = useState(null);
  if (!blocked) return <Navigate to="/" replace />;

  return (
    <Frame>
      <PageHeader
        title="Resolve billing"
        description={blocked.organization.name}
        actions={<ButtonLink to="/onboarding">Back</ButtonLink>}
      />
      <p className="mb-6 flex gap-2 rounded-md border border-line bg-warning-50 px-3 py-2 text-[13px] text-warning-700">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        This organization is suspended. You can review the plan and pay here; everything else stays unavailable until TeamFlow
        support restores access. Paying does not lift the suspension automatically.
      </p>
      {subscription.error ? (
        <ErrorState error={subscription.error} onRetry={subscription.refetch} />
      ) : subscription.isLoading ? (
        <Skeleton className="mb-6 h-40 w-full" />
      ) : (
        <>
          <CurrentPlan data={subscription.data} />
          <Section title="Plans" id="plans" className="mb-8 scroll-mt-20">
            <PlanComparison data={subscription.data} canBuy onChoose={setReviewing} />
          </Section>
        </>
      )}
      <PaymentHistory returnPath="/resolve-billing/return" />
      <ReviewModal plan={reviewing} current={subscription.data} onClose={() => setReviewing(null)} />
    </Frame>
  );
}

export function ResolveBillingReturnPage() {
  const blocked = useBillingResolution();
  if (!blocked) return <Navigate to="/" replace />;
  return (
    <Frame>
      <PaymentReturnPage billingPath="/resolve-billing" />
    </Frame>
  );
}
