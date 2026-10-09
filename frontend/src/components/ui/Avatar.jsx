import { initials } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

// Muted, brand-compatible palette; colour is derived from the name so it is stable across pages.
const PALETTE = [
  'bg-brand-100 text-brand-800',
  'bg-accent-100 text-accent-700',
  'bg-success-50 text-success-700',
  'bg-violet-50 text-violet-600',
  'bg-info-50 text-info-600',
  'bg-warning-50 text-warning-700',
];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' };

export function Avatar({ name = '', size = 'sm', inactive = false, className }) {
  return (
    <span
      title={name}
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-[1.5px] ring-surface',
        inactive ? 'bg-slate-100 text-slate-600' : PALETTE[hash(name) % PALETTE.length],
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars with "+N"; the accessible label lists everyone. */
export function AvatarStack({ people = [], max = 4, size = 'sm' }) {
  if (!people.length) return <span className="text-ink-subtle">—</span>;
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center" role="img" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p, i) => (
        <Avatar key={p.id} name={p.name} size={size} inactive={p.status === 'DEACTIVATED'} className={i ? '-ml-1' : ''} />
      ))}
      {people.length > max && (
        <span className={cn('-ml-1 inline-flex items-center justify-center rounded-full bg-slate-100 font-medium text-slate-600 ring-[1.5px] ring-surface', SIZES[size])}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

/** Avatar + name, used for assignees and leads. */
export function Person({ person, size = 'xs', emptyLabel = 'Unassigned', className }) {
  if (!person) return <span className={cn('text-ink-subtle', className)}>{emptyLabel}</span>;
  const inactive = person.status === 'DEACTIVATED';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar name={person.name} size={size} inactive={inactive} />
      <span className={cn('truncate', inactive && 'text-ink-subtle line-through decoration-ink-subtle/50')}>{person.name}</span>
      {inactive && <span className="sr-only">(deactivated)</span>}
    </span>
  );
}
