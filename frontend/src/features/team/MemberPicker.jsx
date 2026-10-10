import { useMemo, useState } from 'react';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { useMemberOptions } from './api.js';
import { cn } from '../../lib/cn.js';

/**
 * Active members of the current organization as a searchable list — accessible and touch-friendly without a
 * custom combobox. Multi-select (checkboxes) by default; `single` makes it a radio list with a "None" choice
 * (value: id or null). `exclude` hides people already selected elsewhere. Only this organization's members are
 * ever offered (the API returns nothing else).
 */
export function MemberPicker({ value = [], onChange, exclude = [], label = 'Members', maxHeight = 'max-h-56', single = false }) {
  const { data, isLoading } = useMemberOptions();
  const [q, setQ] = useState('');
  const people = useMemo(
    () => (data ?? []).filter((m) => !exclude.includes(m.id) && (!q || m.name.toLowerCase().includes(q.toLowerCase()))),
    [data, exclude, q],
  );
  const selected = (id) => (single ? value === id : value.includes(id));
  const toggle = (id) => (single ? onChange(id) : onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]));
  const name = `${label}-choice`;

  return (
    <fieldset className="rounded-md border border-line-strong">
      <legend className="sr-only">{label}</legend>
      <div className="border-b border-line p-1.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter people…"
          aria-label={`Filter ${label.toLowerCase()}`}
          className="h-9 w-full rounded bg-canvas px-2 text-[16px] outline-none focus:ring-2 focus:ring-brand-500/20 sm:h-7 sm:text-[13px]"
        />
      </div>
      <div className={cn('overflow-y-auto p-1', maxHeight)}>
        {isLoading ? (
          <Spinner className="p-2" />
        ) : (
          <>
            {single && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-2 text-[13px] text-ink-muted hover:bg-canvas sm:py-1.5">
                <input type="radio" name={name} checked={!value} onChange={() => onChange(null)} className="h-4 w-4 accent-brand-800" />
                No one
              </label>
            )}
            {people.length === 0 ? (
              <p className="px-2 py-3 text-center text-[13px] text-ink-subtle">No one to add.</p>
            ) : (
              people.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-2 hover:bg-canvas sm:py-1.5">
                  <input type={single ? 'radio' : 'checkbox'} name={single ? name : undefined} checked={selected(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 accent-brand-800" />
                  <Avatar name={m.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
                  <span className="truncate text-xs text-ink-subtle">{m.jobTitle ?? m.role.name}</span>
                </label>
              ))
            )}
          </>
        )}
      </div>
      {!single && value.length > 0 && <p className="border-t border-line px-2.5 py-1.5 text-xs text-ink-muted">{value.length} selected</p>}
    </fieldset>
  );
}
