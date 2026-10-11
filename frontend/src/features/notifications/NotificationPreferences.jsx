import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { usePreferences, useSavePreferences } from './api.js';
import { Button } from '../../components/ui/Button.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { ErrorState } from '../../components/feedback/States.jsx';
import { cn } from '../../lib/cn.js';

/** Small accessible switch (a checkbox with role="switch"). */
function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className={cn('relative inline-flex h-5 w-9 shrink-0 items-center', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-700 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40" />
      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

/**
 * In-app and email choices per category, saved together. Billing is fixed on (the server refuses changes);
 * password-change alerts are security emails, outside these preferences, and always sent.
 */
export function NotificationPreferences() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);

  if (prefs.error) return <ErrorState compact error={prefs.error} onRetry={prefs.refetch} />;
  if (!draft) return <Skeleton className="h-48 w-full" />;

  const dirty = draft.some((p, i) => p.inApp !== prefs.data[i].inApp || p.email !== prefs.data[i].email);
  const set = (category, channel, value) => setDraft((d) => d.map((p) => (p.category === category ? { ...p, [channel]: value } : p)));
  const submit = () =>
    save.mutate(
      draft.filter((p) => !p.locked).map(({ category, inApp, email }) => ({ category, inApp, email })),
      { onSuccess: () => toast.success('Notification preferences saved'), onError: (err) => toast.error(err.message) },
    );

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-subtle">
            <th scope="col" className="py-2 font-medium">Notify me about</th>
            <th scope="col" className="w-16 py-2 text-center font-medium">In-app</th>
            <th scope="col" className="w-16 py-2 text-center font-medium">Email</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {draft.map((p) => (
            <tr key={p.category}>
              <th scope="row" className="py-2.5 text-left font-normal">
                {p.label}
                {p.locked && <span className="ml-1.5 text-xs text-ink-subtle">· always on</span>}
              </th>
              <td className="text-center"><Switch label={`${p.label}: in-app`} checked={p.inApp} disabled={p.locked} onChange={(v) => set(p.category, 'inApp', v)} /></td>
              <td className="text-center"><Switch label={`${p.label}: email`} checked={p.email} disabled={p.locked} onChange={(v) => set(p.category, 'email', v)} /></td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2.5 text-left font-normal">
              Security alerts <span className="text-xs text-ink-subtle">(password changes)</span>
            </th>
            <td colSpan={2} className="text-center text-xs text-ink-subtle">
              <span className="inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" /> Always emailed</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!dirty}>Save preferences</Button>
        {dirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
      </div>
    </div>
  );
}
