import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { CreateOrganizationDialog } from './CreateOrganizationDialog.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { api } from '../../lib/api.js';
import { initials } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/** Square initials tile: organizations read as places, people (round avatars) as people. */
export function OrgTile({ name, size = 'md', className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-md bg-brand-800 font-semibold text-accent-400',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Organization switcher (combobox). Lists only the caller's own active memberships (from /auth/me —
 * the API never sends anyone else's organizations). Switching goes through the API, which moves the
 * session to that membership; the client then drops every cached query, so no data carries over.
 * Keyboard: ↑/↓ move, Enter selects, Home/End jump, Esc closes and returns focus to the trigger.
 */
export function OrganizationSwitcher() {
  const { me, workspace, applySession } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [switching, setSwitching] = useState(null);
  const [creating, setCreating] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const memberships = me.memberships;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? memberships.filter((m) => m.organization.name.toLowerCase().includes(q)) : memberships;
  }, [memberships, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };

  const choose = async (m) => {
    if (m.id === workspace.membershipId) return close();
    setSwitching(m.id);
    try {
      applySession(await api.post('/auth/switch-workspace', { membershipId: m.id }));
      close(false);
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSwitching(null);
    }
  };

  const onKeyDown = (e) => {
    const last = filtered.length - 1;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]);
    }
  };

  const name = workspace.organization.name;
  const optionId = (i) => `${listId}-opt-${i}`;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-md py-1 pl-1 pr-1.5 transition-colors hover:bg-canvas aria-expanded:bg-canvas"
      >
        <OrgTile name={name} size="sm" />
        <span className="truncate text-[13px] font-semibold">{name}</span>
        <span className="sr-only">, Switch organization</span>
        <ChevronDown size={14} className={cn('shrink-0 text-ink-subtle transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg animate-pop-in"
          onKeyDown={onKeyDown}
          onBlur={(e) => e.relatedTarget && !rootRef.current?.contains(e.relatedTarget) && close(false)}
        >
          <div className="relative border-b border-line">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <input
              autoFocus
              role="combobox"
              aria-label="Search organizations"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? optionId(active) : undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search organizations…"
              className="h-10 w-full bg-transparent pl-8 pr-3 text-[16px] placeholder:text-ink-subtle focus:outline-none sm:h-9 sm:text-[13px]"
            />
          </div>

          <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Your organizations</p>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Your organizations" className="max-h-64 overflow-y-auto px-1 pb-1">
            {filtered.map((m, i) => {
              const current = m.id === workspace.membershipId;
              return (
                <li
                  key={m.id}
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={current}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]',
                    i === active && 'bg-canvas',
                    switching && switching !== m.id && 'opacity-60',
                  )}
                >
                  <OrgTile name={m.organization.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', current && 'font-semibold')}>{m.organization.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-subtle">{m.roleName}</span>
                  </span>
                  {switching === m.id ? (
                    <Spinner size={14} label="Switching" />
                  ) : (
                    current && <Check size={15} className="shrink-0 text-brand-600" aria-label="Current organization" />
                  )}
                </li>
              );
            })}
            {!filtered.length && <li className="px-2 py-4 text-center text-[13px] text-ink-muted">No organizations match “{query.trim()}”.</li>}
          </ul>

          <div className="border-t border-line p-1">
            <button
              type="button"
              onClick={() => {
                close(false);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-brand-700 hover:bg-canvas"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-line-strong">
                <Plus size={13} aria-hidden="true" />
              </span>
              Create organization
            </button>
          </div>
        </div>
      )}

      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
