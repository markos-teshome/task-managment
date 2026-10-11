import { useSearchParams } from 'react-router';
import { Bell, Check, CheckCheck, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api.js';
import { useOpenNotification } from './NotificationBell.jsx';
import { NotificationIcon } from './NotificationItem.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Pagination, Skeleton, Tabs, usePageRecovery } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { relativeTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/** Every notification, paged; the filter and page live in the URL so refresh and back work. */
export function NotificationsPage() {
  useDocumentTitle('Notifications');
  const [params, setParams] = useSearchParams();
  const unread = params.get('filter') === 'unread';
  const page = Number(params.get('page')) || 1;
  const pageSize = [10, 20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20;
  const { data, isLoading, error, refetch } = useNotifications({ unread, page, pageSize });
  const pastEnd = usePageRecovery(data?.meta, (p) => set({ page: p > 1 ? String(p) : null }));
  const { data: count = 0 } = useUnreadCount();
  const markAll = useMarkAllRead();
  const markRead = useMarkRead();
  const openNotification = useOpenNotification();
  const set = (next) => setParams((p) => {
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    return p;
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, reminders and updates for you in this workspace."
        actions={
          <>
            <ButtonLink to="/settings?tab=notifications" icon={Settings} className="max-sm:hidden">Preferences</ButtonLink>
            <Button icon={CheckCheck} disabled={!count} onClick={() => markAll.mutate(undefined, { onError: (err) => toast.error(err.message) })}>
              Mark all as read
            </Button>
          </>
        }
      />
      <div className="mb-3 border-b border-line">
        <Tabs
          tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count }]}
          value={unread ? 'unread' : 'all'}
          onChange={(v) => set({ filter: v === 'unread' ? 'unread' : null, page: null })}
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : !pastEnd && !data.items.length ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={Bell} title={unread ? "You're all caught up" : 'No notifications yet'} description="Task assignments, due date reminders, project changes and billing updates appear here." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {data.items.map((n) => (
              <li key={n.id} className={cn('flex items-start', !n.read && 'bg-brand-50/50')}>
                <button type="button" onClick={() => openNotification(n)} className="flex min-w-0 flex-1 gap-3 px-3 py-2.5 text-left hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none">
                  <NotificationIcon notification={n} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', n.read ? 'text-ink-muted' : 'font-semibold')}>
                      {n.title}
                      {!n.read && <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="block text-[12.5px] text-ink-muted">{n.message}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-subtle">{relativeTime(n.createdAt)}</span>
                </button>
                <span className="flex w-10 shrink-0 justify-center pt-2">
                  {!n.read && (
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Check}
                      aria-label={`Mark “${n.title}” as read`}
                      title="Mark as read"
                      onClick={() => markRead.mutate(n.id, { onError: (err) => toast.error(err.message) })}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!error && <Pagination meta={data?.meta} onPageChange={(p) => set({ page: p > 1 ? String(p) : null })} onPageSizeChange={(n) => set({ pageSize: n === 20 ? null : String(n), page: null })} />}
    </>
  );
}
