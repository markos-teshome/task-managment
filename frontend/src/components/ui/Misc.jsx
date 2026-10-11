import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.jsx';

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('tf-skeleton', className)} />;
}

/** Small inline spinner in brand colour (buttons have their own, sized to keep the button stable). */
export function Spinner({ size = 16, className, label = 'Loading' }) {
  return (
    <span role="status" className={cn('inline-flex items-center text-brand-600', className)}>
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Search box that updates its parent after the user pauses typing (debounced),
 * so lists don't refetch on every keystroke.
 */
export function SearchInput({ value, onChange, placeholder = 'Search…', delay = 300, className, label = 'Search' }) {
  const [draft, setDraft] = useState(value ?? '');
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => setDraft(value ?? ''), [value]);
  useEffect(() => {
    if ((value ?? '') === draft) return undefined;
    const t = setTimeout(() => latest.current(draft), delay);
    return () => clearTimeout(t);
  }, [draft, delay, value]);

  return (
    <div className={cn('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-[16px] shadow-xs placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:h-8 sm:text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:bg-canvas hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Compact filter dropdown for toolbars: shows the active value, "All …" when unset. */
export function FilterSelect({ label, value, onChange, options, allLabel, className }) {
  return (
    <label className={cn('relative inline-flex', className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={cn(
          'h-10 w-full cursor-pointer appearance-none rounded-md border bg-surface pl-2.5 pr-7 text-[16px] shadow-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:h-8 sm:text-[13px]',
          value ? 'border-brand-300 bg-brand-50 font-medium text-brand-800' : 'border-line-strong text-ink-muted',
        )}
      >
        <option value="">{allLabel ?? `All ${label.toLowerCase()}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-ink-subtle" aria-hidden="true" />
    </label>
  );
}

export const PAGE_SIZES = [10, 20, 50, 100];

/** Page numbers to show: first, last, current ±1, with gaps ("…") where pages are skipped. */
function pageWindow(page, total) {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push(p - sorted[i - 1] === 2 ? p - 1 : `gap-${p}`);
    out.push(p);
  });
  return out;
}

/** True while a list shows a page past its end (e.g. its last row was just deleted). */
export const isPastLastPage = (meta) => !!meta && meta.page > 1 && meta.page > meta.totalPages;

/**
 * Moves a list to its last real page when the current one no longer exists — after deleting the last row,
 * a stale link, or switching to a workspace with fewer records. Lists call it themselves too, because an
 * empty page may render something other than the footer.
 */
export function usePageRecovery(meta, onPageChange) {
  const change = useRef(onPageChange);
  change.current = onPageChange;
  const past = isPastLastPage(meta);
  useEffect(() => {
    if (past) change.current(meta.totalPages);
  }, [past, meta?.totalPages]);
  return past;
}

/**
 * One pagination footer for every list, always shown once the list has loaded: "Showing 21–40 of 125"
 * ("Showing 0 of 0" when empty), numbered pages ("Page x of y" on phones), Previous/Next (disabled at the
 * ends) and, when `onPageSizeChange` is given, rows per page. If the current page no longer exists it moves
 * to the last real page (see usePageRecovery).
 */
export function Pagination({ meta, onPageChange, onPageSizeChange, className }) {
  const outOfRange = usePageRecovery(meta, onPageChange);
  if (!meta || outOfRange) return null;
  const empty = meta.total === 0;
  const from = empty ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  const totalPages = Math.max(1, meta.totalPages);
  const numberClass = (active) =>
    cn(
      'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] tabular-nums transition-colors disabled:cursor-default',
      active ? 'bg-brand-800 font-semibold text-white' : 'text-ink-muted hover:bg-canvas hover:text-ink',
    );

  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[13px] text-ink-muted', className)}>
      <span aria-live="polite">
        Showing{' '}
        {empty ? (
          <span className="tabular-nums text-ink">0</span>
        ) : (
          <span className="tabular-nums text-ink">{from}–{to}</span>
        )}{' '}
        of <span className="tabular-nums text-ink">{meta.total}</span>
      </span>
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="max-sm:sr-only">Rows per page</span>
            <select
              value={meta.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-9 rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:h-8"
            >
              {[...new Set([...PAGE_SIZES, meta.pageSize])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page">
            <span className="max-sm:sr-only">Previous</span>
          </Button>
          <ol className="hidden items-center gap-0.5 sm:flex">
            {pageWindow(meta.page, totalPages).map((p) =>
              typeof p === 'string' ? (
                <li key={p} className="px-1 text-ink-subtle" aria-hidden="true">…</li>
              ) : (
                <li key={p}>
                  <button
                    type="button"
                    className={numberClass(p === meta.page)}
                    aria-current={p === meta.page ? 'page' : undefined}
                    aria-label={`Page ${p}`}
                    disabled={p === meta.page}
                    onClick={() => onPageChange(p)}
                  >
                    {p}
                  </button>
                </li>
              ),
            )}
          </ol>
          <span className="px-1 tabular-nums sm:hidden">Page {meta.page} of {totalPages}</span>
          <Button size="sm" variant="secondary" iconRight={ChevronRight} disabled={meta.page >= totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page">
            <span className="max-sm:sr-only">Next</span>
          </Button>
        </div>
      </div>
    </nav>
  );
}

/** Accessible tabs bound to a value (often a URL param). */
export function Tabs({ tabs, value, onChange, className }) {
  const refs = useRef({});
  const onKeyDown = (e, index) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const next = tabs[(index + dir + tabs.length) % tabs.length];
    onChange(next.value);
    refs.current[next.value]?.focus();
  };
  return (
    <div role="tablist" className={cn('-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]', className)}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[t.value] = el)}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors',
              active ? 'text-brand-800' : 'text-ink-muted hover:text-ink',
              'after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full',
              active && 'after:bg-accent-500',
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cn('rounded px-1 text-[11px] tabular-nums', active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink-muted')}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
