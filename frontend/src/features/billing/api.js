import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidate } from '../../lib/query.js';
import { useAuth } from '../auth/AuthProvider.jsx';

export const useSubscription = () => useQuery({ queryKey: ['subscription'], queryFn: () => api.get('/subscription') });

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api.get('/subscription/plans'), staleTime: 5 * 60_000 });

export const usePayments = (params, enabled = true) =>
  useQuery({ queryKey: ['payments', params], queryFn: () => api.list('/payments', params), placeholderData: keepPreviousData, enabled });

export const useCheckout = () => useMutation({ mutationFn: (planId) => api.post('/payments/checkout', { planId }) });

/** After any change that may alter the plan, refresh everything that shows limits. */
export function useRefreshEntitlements() {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  return () => {
    invalidate(qc, 'subscription', 'payments', 'payment', 'organization', 'dashboard', 'activities');
    return reloadMe().catch(() => {});
  };
}

export function useSubscriptionAction() {
  const refresh = useRefreshEntitlements();
  return useMutation({ mutationFn: (action) => api.post(`/subscription/${action}`), onSuccess: refresh });
}
