import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { invalidateWork } from '../../lib/query.js';

export const useTasks = (params, options) =>
  useQuery({ queryKey: ['tasks', params], queryFn: () => api.list('/tasks', params), placeholderData: keepPreviousData, ...options });

export const useTask = (id) => useQuery({ queryKey: ['task', id], queryFn: () => api.get(`/tasks/${id}`), enabled: !!id });

export const useMyWork = (options) => useQuery({ queryKey: ['my-work'], queryFn: () => api.get('/tasks/my-work'), ...options });

export const useTaskActivity = (id, enabled) =>
  useQuery({ queryKey: ['activities', 'task', id], queryFn: () => api.list('/activities', { entityId: id, pageSize: 30 }), enabled: !!id && enabled });

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => api.post('/tasks', body), onSuccess: () => invalidateWork(qc) });
}

/**
 * Task updates are optimistic in the open task view (instant status changes), then
 * reconciled with the server; on failure the previous value is restored.
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/tasks/${id}`, body),
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: ['task', id] });
      const previous = qc.getQueryData(['task', id]);
      if (previous) qc.setQueryData(['task', id], { ...previous, ...body });
      return { previous, id };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['task', context.id], context.previous);
    },
    onSuccess: (task) => qc.setQueryData(['task', task.id], task),
    onSettled: () => invalidateWork(qc),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id) => api.delete(`/tasks/${id}`), onSuccess: () => invalidateWork(qc) });
}

/** Downloads the CSV export with the current filters (Business plan feature). */
export async function downloadTasksCsv(filters) {
  const res = await api.download('/tasks/export', filters);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `tasks-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
