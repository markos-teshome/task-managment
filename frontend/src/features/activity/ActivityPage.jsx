import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History, SearchX } from 'lucide-react';
import { api } from '../../lib/api.js';
import { ActivityItem } from './ActivityItem.jsx';
import { useMemberOptions } from '../team/api.js';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Form.jsx';
import { FilterSelect, Skeleton } from '../../components/ui/Misc.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { dayHeading } from '../../lib/format.js';

const KEYS = ['actorId', 'entityType', 'from', 'to'];
const TYPES = [
  { value: 'PROJECT', label: 'Projects' },
  { value: 'TASK', label: 'Tasks' },
  { value: 'MEMBER', label: 'Team' },
  { value: 'ROLE', label: 'Roles' },
  { value: 'SUBSCRIPTION', label: 'Subscription' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'ORGANIZATION', label: 'Organization' },
];

/** Organization history as a day-grouped timeline, filterable by person, type and date. */
export function ActivityPage() {
  useDocumentTitle('Activity');
  const { filters, setFilters, clear, active, activeCount } = useUrlFilters(KEYS);
  const members = useMemberOptions();

  const query = useInfiniteQuery({
    queryKey: ['activities', 'feed', filters],
    // Cursor paging: "Load more" continues after the last entry shown, so new activity can't shift or repeat entries.
    queryFn: ({ pageParam }) => api.list('/activities', { ...filters, cursor: pageParam, pageSize: 40 }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });

  const groups = useMemo(() => {
    const items = query.data?.pages.flatMap((p) => p.items) ?? [];
    const out = [];
    for (const a of items) {
      const heading = dayHeading(a.createdAt);
      if (out.at(-1)?.heading !== heading) out.push({ heading, items: [] });
      out.at(-1).items.push(a);
    }
    return out;
  }, [query.data]);

  return (
    <>
      <PageHeader title="Activity" description="Who did what, and when, across your organization." />
      <Toolbar activeCount={activeCount} onClear={clear}>
        {members.data && (
          <FilterSelect label="Person" value={filters.actorId} onChange={(actorId) => setFilters({ actorId })} options={members.data.map((m) => ({ value: m.id, label: m.name }))} allLabel="Everyone" />
        )}
        <FilterSelect label="Type" value={filters.entityType} onChange={(entityType) => setFilters({ entityType })} options={TYPES} allLabel="All activity" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
          From
          <Input type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => setFilters({ from: e.target.value })} className="w-auto" />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
          To
          <Input type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => setFilters({ to: e.target.value })} className="w-auto" />
        </label>
      </Toolbar>

      {query.error ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-6 w-full max-w-2xl" />)}
        </div>
      ) : groups.length === 0 ? (
        active ? (
          <EmptyState icon={SearchX} title="No activity matches these filters" action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={History} title="No activity yet" description="Project, task, team and billing changes will be recorded here." />
        )
      ) : (
        <div className="max-w-3xl space-y-5">
          {groups.map((g) => (
            <section key={g.heading} aria-label={g.heading}>
              <h2 className="sticky top-14 z-10 -mx-1 mb-1 bg-canvas/95 px-1 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle backdrop-blur">
                {g.heading}
              </h2>
              <ol className="rounded-lg border border-line bg-surface px-3 py-1">
                {g.items.map((a) => (
                  <ActivityItem key={a.id} activity={a} showClock />
                ))}
              </ol>
            </section>
          ))}
          {query.hasNextPage && (
            <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
              Load older activity
            </Button>
          )}
        </div>
      )}
    </>
  );
}
