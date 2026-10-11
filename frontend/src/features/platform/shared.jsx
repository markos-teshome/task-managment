import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { api } from '../../lib/api.js';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Textarea } from '../../components/ui/Form.jsx';
import { cn } from '../../lib/cn.js';

/*
 * Shared pieces of the platform console. Everything here talks only to /api/v1/platform, whose responses are
 * allowlisted metadata (no projects, tasks, activity details or people's work), authenticated by the
 * platform session cookie — never by a tenant session.
 */

export const usePlatformQuery = (path, params, options) =>
  useQuery({
    queryKey: ['platform', path, params ?? null],
    queryFn: () => (params ? api.list(`/platform${path}`, params) : api.get(`/platform${path}`)),
    placeholderData: keepPreviousData,
    ...options,
  });

/** Compact row of figures (one line on desktop, wrapping on phones). */
export function StatStrip({ items, className }) {
  return (
    <div className={cn('flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line', className)}>
      {items.filter(Boolean).map(({ label, value, sub, tone, to }) => {
        const body = (
          <>
            <span className="block text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{label}</span>
            <span className={cn('mt-0.5 block text-xl font-semibold tabular-nums leading-tight', tone === 'danger' && value ? 'text-danger-600' : tone === 'warning' && value ? 'text-warning-700' : 'text-ink')}>
              {value}
            </span>
            {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
          </>
        );
        return to ? (
          <Link key={label} to={to} className="block min-w-[150px] flex-1 bg-surface px-4 py-2.5 transition-colors hover:bg-canvas">
            {body}
          </Link>
        ) : (
          <div key={label} className="min-w-[150px] flex-1 bg-surface px-4 py-2.5">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Human labels for platform audit actions. */
export const AUDIT_LABELS = {
  PLATFORM_SIGNED_IN: 'Signed in to the console',
  ORGANIZATION_SUSPENDED: 'Suspended organization',
  ORGANIZATION_REACTIVATED: 'Reactivated organization',
  ORGANIZATION_CLOSED: 'Closed organization',
  ORGANIZATION_REOPENED: 'Reopened organization',
  PLAN_CREATED: 'Created plan',
  PLAN_UPDATED: 'Changed plan',
  PLATFORM_ADMIN_CREATED: 'Platform admin created',
  PLATFORM_ADMIN_DISABLED: 'Platform admin disabled',
  PLATFORM_ADMIN_ENABLED: 'Platform admin enabled',
  PLATFORM_ADMIN_PASSWORD_RESET: 'Platform admin password reset',
};

/** One-line, non-sensitive description of an audit entry (names and reasons only; never tenant content). */
export function describeAudit(entry) {
  const m = entry.metadata ?? {};
  const target = m.name ?? m.code ?? m.email ?? '';
  const extra = entry.action === 'ORGANIZATION_SUSPENDED' && m.reason ? ` — “${m.reason}”` : entry.action === 'PLAN_UPDATED' && m.changes ? ` (${Object.keys(m.changes).join(', ')})` : '';
  return `${AUDIT_LABELS[entry.action] ?? entry.action}${target ? ` ${target}` : ''}${extra}`;
}

const STATUS_CHANGE = {
  SUSPENDED: {
    title: (n) => `Suspend ${n}?`,
    body: 'Its members lose access on their next request and see that the organization is suspended. No data, billing or history is deleted, and you can reactivate it at any time.',
    label: 'Suspend organization',
    done: (n) => `${n} suspended`,
    tone: 'danger',
  },
  CLOSED: {
    title: (n) => `Close ${n}?`,
    body: 'Processes the owner’s closure request. Members are refused; all data, billing and history are kept, and you can reopen it later.',
    label: 'Close organization',
    done: (n) => `${n} closed`,
    tone: 'danger',
  },
  ACTIVE: {
    title: (n) => `Reactivate ${n}?`,
    body: 'Its members regain access on their next request, with their data exactly as it was.',
    label: 'Reactivate',
    done: (n) => `${n} reactivated`,
    tone: 'primary',
  },
};

/**
 * Suspend, close (D-9) or reactivate an organization. Suspension requires a reason (recorded in the audit log);
 * none of these deletes anything. The server's answer is the source of truth. `target` defaults to the
 * suspend/reactivate toggle.
 */
export function OrganizationStatusDialog({ org, target, onClose }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const status = target ?? (org?.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  const copy = STATUS_CHANGE[status];
  const suspending = status === 'SUSPENDED';
  const reopening = status === 'ACTIVE' && org?.status === 'CLOSED';
  const mutation = useMutation({
    mutationFn: () => api.patch(`/platform/organizations/${org.id}/status`, { status, ...(reason.trim() && { reason: reason.trim() }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      toast.success(reopening ? `${org.name} reopened` : copy.done(org.name));
      setReason('');
      onClose();
    },
    onError: setError,
  });
  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };
  return (
    <ConfirmDialog
      open={!!org}
      onOpenChange={(open) => !open && close()}
      title={reopening ? `Reopen ${org?.name}?` : copy.title(org?.name)}
      description={reopening ? 'Its members regain access with their data exactly as it was. The closure request is cleared.' : copy.body}
      confirmLabel={reopening ? 'Reopen' : copy.label}
      tone={copy.tone}
      loading={mutation.isPending}
      onConfirm={() => {
        if (suspending && reason.trim().length < 3) return setError({ message: 'Give a short reason for the suspension.' });
        mutation.mutate();
      }}
    >
      <div className="mt-3 space-y-3">
        <FormAlert>{error?.message}</FormAlert>
        {suspending && (
          <Field label="Reason" required hint="Recorded in the platform audit log.">
            <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unpaid invoices since September" />
          </Field>
        )}
      </div>
    </ConfirmDialog>
  );
}
