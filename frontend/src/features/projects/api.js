import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidateWork } from '../../lib/query.js';

export const useProjects = (params, options) =>
  useQuery({ queryKey: ['projects', params], queryFn: () => api.list('/projects', params), placeholderData: keepPreviousData, ...options });

export const useProject = (id) => useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`), enabled: !!id });

export const useProjectActivity = (id, enabled) =>
  useQuery({ queryKey: ['activities', 'project', id], queryFn: () => api.get(`/projects/${id}/activity`), enabled: !!id && enabled });

/** All project mutations invalidate the shared work caches on success. */
function useWorkMutation(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateWork(qc) });
}

export const useCreateProject = () => useWorkMutation((body) => api.post('/projects', body));
export const useUpdateProject = (id) => useWorkMutation((body) => api.patch(`/projects/${id}`, body));
export const useArchiveProject = (id) => useWorkMutation((archive) => api.post(`/projects/${id}/${archive ? 'archive' : 'restore'}`));
/** `onDeleted` runs before the caches refresh, so the page can leave before its project is refetched (404). */
export function useDeleteProject(id, onDeleted) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmName) => api.delete(`/projects/${id}`, { body: { confirmName } }),
    onSuccess: () => {
      onDeleted?.();
      qc.removeQueries({ queryKey: ['project', id] });
      return invalidateWork(qc);
    },
  });
}
export const useAddProjectMembers = (id) => useWorkMutation((membershipIds) => api.post(`/projects/${id}/members`, { membershipIds }));
export const useRemoveProjectMember = (id) => useWorkMutation((membershipId) => api.delete(`/projects/${id}/members/${membershipId}`));
