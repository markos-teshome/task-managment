import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.jsx';

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-slate-200/70', className)} />;
}

export function Spinner({ size = 16, className, label = 'Loading' }) {
  return (
    <span role="status" className={cn('inline-flex items-center text-ink-subtle', className)}>
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

export function Pagination({ meta, onPageChange, className }) {
  if (!meta || meta.totalPages <= 1) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-3 py-3 text-[13px] text-ink-muted', className)}>
      <span>
        <span className="tabular-nums">{from}–{to}</span> of <span className="tabular-nums">{meta.total}</span>
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" iconRight={ChevronRight} disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)}>
          Next
        </Button>
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
