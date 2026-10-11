import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

/**
 * Notifications of the signed-in person in the active workspace. Keys include the membership, so another
 * workspace's count or list is never shown (switching also clears the whole cache).
 */
const useScope = () => useAuth().workspace?.membershipId;

/** Polled once a minute while the tab is visible (React Query pauses in the background), plus on focus. */
export function useUnreadCount() {
  const scope = useScope();
  return useQuery({
    queryKey: ['notifications', scope, 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count'),
    enabled: !!scope,
    refetchInterval: 60_000,
    staleTime: 15_000,
    select: (d) => d.count,
  });
}

export function useNotifications({ unread = false, page = 1, pageSize = 20 } = {}, { enabled = true } = {}) {
  const scope = useScope();
  return useQuery({
    queryKey: ['notifications', scope, 'list', { unread, page, pageSize }],
    queryFn: () => api.list('/notifications', { unread: unread || undefined, page, pageSize }),
    enabled: !!scope && enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * Reading updates the badge and every cached list at once (optimistic), rolls back if the server refuses,
 * and then re-reads the server's truth. `ids === null` means "all".
 */
function useReadMutation(fn, idsOf) {
  const qc = useQueryClient();
  const scope = useScope();
  const root = ['notifications', scope];
  return useMutation({
    mutationFn: fn,
    onMutate: async (arg) => {
      await qc.cancelQueries({ queryKey: root }); // an in-flight older answer must not overwrite this
      const snapshot = qc.getQueriesData({ queryKey: root });
      const ids = idsOf(arg);
      const hits = (n) => !n.read && (ids === null || ids.includes(n.id));
      // How many unread ones this changes (from any cached list; "all" clears the count).
      const changed = new Set();
      for (const [key, data] of snapshot) if (key[2] === 'list') data?.items.filter(hits).forEach((n) => changed.add(n.id));
      qc.setQueriesData({ queryKey: [...root, 'list'] }, (data) => data && { ...data, items: data.items.map((n) => (hits(n) ? { ...n, read: true } : n)) });
      qc.setQueryData([...root, 'unread-count'], (data) => data && { count: ids === null ? 0 : Math.max(0, data.count - changed.size) });
      return { snapshot };
    },
    onError: (_err, _arg, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: root }),
  });
}

export const useMarkRead = () => useReadMutation((id) => api.patch(`/notifications/${id}/read`), (id) => [id]);
export const useMarkAllRead = () => useReadMutation(() => api.patch('/notifications/read-all'), () => null);

/** Warm the bell's list on hover/focus so it opens with content. */
export function usePrefetchBell() {
  const qc = useQueryClient();
  const scope = useScope();
  return () =>
    scope &&
    qc.prefetchQuery({
      queryKey: ['notifications', scope, 'list', { unread: false, page: 1, pageSize: 8 }],
      queryFn: () => api.list('/notifications', { page: 1, pageSize: 8 }),
      staleTime: 10_000,
    });
}

export function usePreferences() {
  const scope = useScope();
  return useQuery({ queryKey: ['notification-preferences', scope], queryFn: () => api.get('/notification-preferences'), enabled: !!scope });
}

export function useSavePreferences() {
  const qc = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (preferences) => api.patch('/notification-preferences', { preferences }),
    onSuccess: (data) => qc.setQueryData(['notification-preferences', scope], data), // the server's saved state
  });
}
