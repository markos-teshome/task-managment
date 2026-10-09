import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidate } from '../../lib/query.js';
import { useAuth } from '../auth/AuthProvider.jsx';

export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: () => api.get('/roles'), enabled });

export const usePermissionCatalog = () =>
  useQuery({ queryKey: ['permissions'], queryFn: () => api.get('/roles/permissions'), staleTime: Infinity });

function useRoleMutation(fn) {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate(qc, 'roles', 'members', 'activities');
      reloadMe().catch(() => {}); // own permissions may have changed
    },
  });
}

export const useCreateRole = () => useRoleMutation((body) => api.post('/roles', body));
export const useUpdateRole = () => useRoleMutation(({ id, ...body }) => api.patch(`/roles/${id}`, body));
export const useDeleteRole = () => useRoleMutation((id) => api.delete(`/roles/${id}`));
