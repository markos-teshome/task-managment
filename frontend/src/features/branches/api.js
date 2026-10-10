import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidate } from '../../lib/query.js';
import { useAuth } from '../auth/AuthProvider.jsx';

/*
 * Branches of the active organization. Query keys need no organization id: switching organizations clears
 * the whole query cache (AuthProvider.applySession), so cached data never crosses workspaces.
 */

export const useBranches = (params = {}, { enabled = true } = {}) =>
  useQuery({ queryKey: ['branches', params], queryFn: () => api.get('/branches', { query: params }), enabled });

export const useBranch = (id) => useQuery({ queryKey: ['branch', id], queryFn: () => api.get(`/branches/${id}`), enabled: !!id });

/** Branch changes move counts, the project branch picker, usage and the caller's own branches (in /auth/me). */
function useBranchMutation(fn) {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate(qc, 'branches', 'branch', 'projects', 'project', 'dashboard', 'activities', 'organization');
      reloadMe().catch(() => {});
    },
  });
}

export const useCreateBranch = () => useBranchMutation((body) => api.post('/branches', body));
export const useUpdateBranch = (id) => useBranchMutation((body) => api.patch(`/branches/${id}`, body));
export const useAddBranchMembers = (id) => useBranchMutation((membershipIds) => api.post(`/branches/${id}/members`, { membershipIds }));
export const useRemoveBranchMember = (id) => useBranchMutation((membershipId) => api.delete(`/branches/${id}/members/${membershipId}`));

/**
 * Branches the caller may put a project in: every active branch with BRANCH_MANAGE, otherwise the ones they
 * work in. The server re-checks this on save.
 */
export function useAssignableBranches() {
  const { can, workspace } = useAuth();
  const manageAll = can('BRANCH_MANAGE');
  const all = useBranches({ status: 'ACTIVE' }, { enabled: manageAll });
  if (manageAll) return { branches: all.data ?? [], isLoading: all.isLoading };
  return { branches: workspace?.myBranches ?? [], isLoading: false };
}

/** True when the organization has more than one active branch — only then are branch choices worth showing. */
export const useHasSeveralBranches = () => (useAuth().workspace?.usage.branches ?? 1) > 1;
