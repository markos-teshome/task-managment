import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { cn } from '../../lib/cn.js';

/** Consistent page heading: title, one-line description, actions on the right. */
export function PageHeader({ title, description, actions, children, className }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Search + filters above a list.
 * Desktop: one inline row. Phones: search and a "Filters" button; the filters open below as a
 * two-column grid, so nothing is squeezed to unreadable widths.
 */
export function Toolbar({ search, activeCount = 0, onClear, children, className }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('mb-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && <div className="min-w-0 flex-1 sm:flex-none">{search}</div>}
        {children && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink shadow-xs sm:hidden"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Filters
            {activeCount > 0 && <span className="rounded bg-brand-800 px-1.5 text-[11px] text-white">{activeCount}</span>}
          </button>
        )}
        <div className={cn('w-full gap-2 sm:flex sm:w-auto sm:flex-1 sm:flex-wrap sm:items-center', open ? 'grid grid-cols-2' : 'hidden')}>
          {children}
          {onClear && activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} className="max-sm:col-span-2">
              Clear filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Section inside a page: small uppercase title + optional action, no card chrome. */
export function Section({ title, action, children, className, id }) {
  return (
    <section className={className} aria-labelledby={id}>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <h2 id={id} className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Bordered surface for grouped content — used sparingly, not around everything. */
export function Panel({ children, className, as: Tag = 'div' }) {
  return <Tag className={cn('rounded-lg border border-line bg-surface', className)}>{children}</Tag>;
}
