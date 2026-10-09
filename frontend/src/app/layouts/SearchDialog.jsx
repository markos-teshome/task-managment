import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import * as RD from '@radix-ui/react-dialog';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FolderKanban, Search, SquareCheck, User } from 'lucide-react';
import { api } from '../../lib/api.js';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { PROJECT_STATUS, TASK_STATUS } from '../../lib/status.js';
import { useOpenTask } from '../../features/tasks/useOpenTask.js';

/** Quick search across projects, tasks and people (Ctrl/⌘ + K). Same visibility rules as the lists. */
export function SearchDialog({ open, onOpenChange }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const openTask = useOpenTask();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get('/dashboard/search', { query: { q: debounced } }),
    enabled: open && debounced.length >= 2,
    placeholderData: keepPreviousData,
  });

  const go = (fn) => {
    onOpenChange(false);
    fn();
  };
  const empty = data && !data.projects.length && !data.tasks.length && !data.members.length;

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-fade-in" />
        <RD.Content className="fixed inset-x-2 top-2 z-50 overflow-hidden rounded-lg bg-surface shadow-lg data-[state=open]:animate-pop-in sm:inset-x-auto sm:left-1/2 sm:top-[12vh] sm:w-full sm:max-w-xl sm:-translate-x-1/2">
          <RD.Title className="sr-only">Search</RD.Title>
          <RD.Description className="sr-only">Search projects, tasks and people</RD.Description>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={16} className="text-ink-subtle" aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects, tasks and people…"
              aria-label="Search"
              className="h-12 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-subtle sm:text-sm"
            />
            {isFetching && <Spinner />}
            <kbd className="hidden rounded border border-line px-1.5 text-[11px] text-ink-subtle sm:inline">Esc</kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {debounced.length < 2 ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-subtle">Type at least 2 characters.</p>
            ) : empty ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-muted">No results for “{debounced}”.</p>
            ) : (
              data && (
                <>
                  <Group title="Projects" items={data.projects}>
                    {(p) => (
                      <Result key={p.id} icon={FolderKanban} onSelect={() => go(() => navigate(`/projects/${p.id}`))}>
                        <span className="flex-1 truncate">{p.name}</span>
                        <StatusBadge map={PROJECT_STATUS} value={p.status} />
                      </Result>
                    )}
                  </Group>
                  <Group title="Tasks" items={data.tasks}>
                    {(t) => (
                      <Result key={t.id} icon={SquareCheck} onSelect={() => go(() => openTask(t.id))}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{t.title}</span>
                          <span className="block truncate text-xs text-ink-subtle">{t.project.name}</span>
                        </span>
                        <StatusBadge map={TASK_STATUS} value={t.status} />
                      </Result>
                    )}
                  </Group>
                  <Group title="People" items={data.members}>
                    {(m) => (
                      <Result key={m.id} icon={User} onSelect={() => go(() => navigate(`/team?search=${encodeURIComponent(m.email)}`))}>
                        <span className="flex-1 truncate">{m.name}</span>
                        <span className="truncate text-xs text-ink-subtle">{m.email}</span>
                      </Result>
                    )}
                  </Group>
                </>
              )
            )}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Group({ title, items, children }) {
  if (!items.length) return null;
  return (
    <div className="mb-1">
      <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{title}</p>
      <ul>{items.map(children)}</ul>
    </div>
  );
}

function Result({ icon: Icon, onSelect, children }) {
  return (
    <li>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-canvas focus:bg-canvas focus:outline-none">
        <Icon size={15} className="shrink-0 text-ink-subtle" aria-hidden="true" />
        {children}
      </button>
    </li>
  );
}
