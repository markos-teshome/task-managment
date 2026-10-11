import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidate } from '../../lib/query.js';
import { useAuth } from '../auth/AuthProvider.jsx';

export const useMembers = (params) =>
  useQuery({ queryKey: ['members', params], queryFn: () => api.list('/users', params), placeholderData: keepPreviousData });

/** Active members for pickers. Only fetched when the caller may use them. */
export function useMemberOptions() {
  const { canAny, workspace } = useAuth();
  // Branch managers pick their branch's people even without a people permission (F-01).
  const managesBranch = workspace?.myBranches?.some((b) => b.isManager);
  return useQuery({
    queryKey: ['member-options'],
    queryFn: () => api.get('/users/options'),
    enabled: canAny('USER_VIEW', 'TASK_ASSIGN', 'PROJECT_CREATE', 'PROJECT_UPDATE') || !!managesBranch,
    staleTime: 60_000,
  });
}

/** Current organization incl. plan limits and live usage (seats, projects). */
export const useOrganization = () => useQuery({ queryKey: ['organization'], queryFn: () => api.get('/organizations/current') });

function useMemberMutation(fn) {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate(qc, 'members', 'member-options', 'organization', 'activities', 'dashboard', 'roles', 'subscription');
      reloadMe().catch(() => {});
    },
  });
}

export const useInviteMember = () => useMemberMutation((body) => api.post('/users', body));
/** What a member is responsible for — shown before deactivating them (F-02). */
export const useMemberResponsibilities = (id) =>
  useQuery({ queryKey: ['member-responsibilities', id], queryFn: () => api.get(`/users/${id}/responsibilities`), enabled: !!id });

export const useUpdateMember = () => useMemberMutation(({ id, ...body }) => api.patch(`/users/${id}`, body));
export const useRemoveMember = () => useMemberMutation((id) => api.delete(`/users/${id}`));
/** A resend issues a new link with a fresh expiry, so the list's invitation status changes too. */
export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id) => api.post(`/users/${id}/resend-invitation`), onSuccess: () => invalidate(qc, 'members') });
}
