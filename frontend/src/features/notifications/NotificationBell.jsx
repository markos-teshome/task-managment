import { useState } from 'react';
import { useNavigate } from 'react-router';
import * as DM from '@radix-ui/react-dropdown-menu';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useMarkAllRead, useMarkRead, usePrefetchBell, useNotifications, useUnreadCount } from './api.js';
import { NotificationIcon } from './NotificationItem.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { relativeTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/** Opens a notification: marked read (server-confirmed), then its page. Shared by the bell and the full list. */
export function useOpenNotification() {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  return (n) => {
    if (!n.read) markRead.mutate(n.id, { onError: (err) => toast.error(err.message) });
    if (n.link) navigate(n.link);
  };
}

/**
 * Bell with unread badge and a compact list. Built on the Radix menu: arrow keys move between notifications,
 * Escape closes and focus returns to the bell.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const navigate = useNavigate();
  const { data: count = 0 } = useUnreadCount();
  const list = useNotifications({ unread: unreadOnly, pageSize: 8 }, { enabled: open });
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const markRead = useMarkRead();
  const prefetch = usePrefetchBell();
  const items = list.data?.items ?? [];

  return (
    <DM.Root open={open} onOpenChange={setOpen}>
      <DM.Trigger
        onPointerEnter={prefetch}
        onFocus={prefetch}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-canvas hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Bell size={18} aria-hidden="true" />
        {count > 0 && (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] font-bold leading-4 text-brand-900 tabular-nums" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-h-[min(32rem,calc(100dvh-5rem))] w-[min(23rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg data-[state=open]:animate-pop-in"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <DM.Label className="text-[13px] font-semibold">
              Notifications {count > 0 && <span className="ml-1 rounded bg-brand-50 px-1 text-[11px] font-medium text-brand-700 tabular-nums">{count} unread</span>}
            </DM.Label>
            <DM.RadioGroup value={unreadOnly ? 'unread' : 'all'} onValueChange={(v) => setUnreadOnly(v === 'unread')} className="flex rounded-md bg-canvas p-0.5" aria-label="Show">
              {[['all', 'All'], ['unread', 'Unread']].map(([value, label]) => (
                <DM.RadioItem
                  key={value}
                  value={value}
                  onSelect={(e) => e.preventDefault()}
                  className="cursor-pointer rounded px-2 py-0.5 text-[12px] text-ink-muted outline-none data-[highlighted]:text-ink data-[state=checked]:bg-surface data-[state=checked]:font-medium data-[state=checked]:text-brand-800 data-[state=checked]:shadow-xs"
                >
                  {label}
                </DM.RadioItem>
              ))}
            </DM.RadioGroup>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.isLoading ? (
              <div className="space-y-2 p-2" aria-busy="true">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : list.error ? (
              <div className="px-3 py-6 text-center text-[13px] text-ink-muted">
                Couldn't load notifications.{' '}
                <DM.Item onSelect={(e) => (e.preventDefault(), list.refetch())} className="inline cursor-pointer font-medium text-brand-700 outline-none data-[highlighted]:underline">
                  Try again
                </DM.Item>
              </div>
            ) : !items.length ? (
              <p className="px-3 py-8 text-center text-[13px] text-ink-muted">
                {unreadOnly ? "You're all caught up." : 'No notifications yet. Assignments, reminders and billing updates appear here.'}
              </p>
            ) : (
              items.map((n) => (
                <div key={n.id} className={cn('flex items-start rounded-md', !n.read && 'bg-brand-50/60')}>
                  <DM.Item onSelect={() => openNotification(n)} className="flex min-w-0 flex-1 cursor-pointer gap-2.5 rounded-md px-2 py-2 outline-none data-[highlighted]:bg-canvas">
                    <NotificationIcon notification={n} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px]', n.read ? 'text-ink-muted' : 'font-semibold text-ink')}>
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="line-clamp-2 text-[12px] text-ink-muted">{n.message}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-subtle">{relativeTime(n.createdAt)}</span>
                    </span>
                  </DM.Item>
                  {!n.read && (
                    <DM.Item
                      onSelect={(e) => {
                        e.preventDefault(); // stay open: just mark it
                        markRead.mutate(n.id, { onError: (err) => toast.error(err.message) });
                      }}
                      aria-label={`Mark “${n.title}” as read`}
                      title="Mark as read"
                      className="m-1.5 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-subtle outline-none data-[highlighted]:bg-surface data-[highlighted]:text-brand-700"
                    >
                      <Check size={14} aria-hidden="true" />
                    </DM.Item>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-1 py-1">
            <DM.Item
              disabled={!count || markAll.isPending}
              onSelect={(e) => {
                e.preventDefault();
                markAll.mutate(undefined, { onError: (err) => toast.error(err.message) });
              }}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12.5px] text-ink-muted outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-canvas data-[highlighted]:text-ink"
            >
              <CheckCheck size={14} aria-hidden="true" /> Mark all as read
            </DM.Item>
            <DM.Item
              onSelect={() => navigate('/notifications')}
              className="flex h-8 cursor-pointer items-center rounded-md px-2 text-[12.5px] font-medium text-brand-700 outline-none data-[highlighted]:bg-canvas"
            >
              View all
            </DM.Item>
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
