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

/** Reading changes the count and every list: refresh them all after the server confirms. */
function useNotificationMutation(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
}

export const useMarkRead = () => useNotificationMutation((id) => api.patch(`/notifications/${id}/read`));
export const useMarkAllRead = () => useNotificationMutation(() => api.patch('/notifications/read-all'));

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
