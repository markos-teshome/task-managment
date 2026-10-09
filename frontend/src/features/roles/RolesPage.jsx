import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useCreateRole, useDeleteRole, usePermissionCatalog, useRoles, useUpdateRole } from './api.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { pluralize } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

const GROUP_ORDER = ['Projects', 'Tasks', 'Team', 'Roles', 'Activity', 'Subscription', 'Billing', 'Organization'];

export function RolesPage() {
  useDocumentTitle('Roles & permissions');
  const { can } = useAuth();
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('role');
  const select = (id) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('role', id);
      else next.delete('role');
      return next;
    });

  const desktop = useMediaQuery('(min-width: 1024px)');
  // On desktop the editor is always visible, so open the first role instead of an empty pane.
  const selected = roles.data?.find((r) => r.id === selectedId) ?? (desktop ? roles.data?.[0] : null) ?? null;
  const canCreate = can('ROLE_CREATE');

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Decide what each role in your organization can see and do."
        actions={
          canCreate && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New role
            </Button>
          )
        }
      />

      {roles.error || catalog.error ? (
        <ErrorState error={roles.error ?? catalog.error} onRetry={() => (roles.refetch(), catalog.refetch())} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ul className={cn('h-fit divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface', selected && 'max-lg:hidden')} aria-label="Roles">
            {roles.isLoading
              ? Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="space-y-1.5 p-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-40" />
                  </li>
                ))
              : roles.data.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => select(r.id)}
                      aria-current={r.id === selected?.id || undefined}
                      className={cn('relative block w-full px-3 py-2.5 text-left transition-colors hover:bg-canvas', r.id === selected?.id && 'bg-brand-50/60')}
                    >
                      {r.id === selected?.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-accent-500" aria-hidden="true" />}
                      <span className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium">{r.name}</span>
                        {r.isLocked ? <Lock size={12} className="text-ink-subtle" aria-label="Locked" /> : r.isSystem ? <Badge>Default</Badge> : <Badge tone="violet">Custom</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">{r.description ?? 'No description'}</span>
                      <span className="mt-1 block text-[11.5px] text-ink-subtle">
                        {r.isLocked ? 'All permissions' : pluralize(r.permissions.length, 'permission')} · {pluralize(r.memberCount, 'member')}
                      </span>
                    </button>
                  </li>
                ))}
          </ul>

          <div className={cn(!selected && 'max-lg:hidden')}>
            {selected && catalog.data ? (
              <RoleEditor key={selected.id} role={selected} catalog={catalog.data} onBack={() => select(null)} onDeleted={() => select(null)} />
            ) : (
              <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
                <ShieldCheck size={20} className="mb-2 text-ink-subtle" aria-hidden="true" />
                <p className="text-[13.5px] font-medium">Select a role to see its permissions</p>
                <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
                  Default roles cover most teams. Create a custom role when someone needs a different mix of permissions.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateRoleModal
        open={creating}
        onOpenChange={setCreating}
        catalog={catalog.data ?? []}
        onCreated={(role) => select(role.id)}
      />
    </>
  );
}

/** Permissions grouped by area with plain-language labels ("Projects → Create"). */
function PermissionGrid({ catalog, value, onToggle, disabled, isAllowed }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of catalog) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return [...map.entries()].sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  }, [catalog]);

  return (
    <div className="divide-y divide-line">
      {groups.map(([group, perms]) => (
        <fieldset key={group} className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[140px_1fr]">
          <legend className="sr-only">{group}</legend>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle" aria-hidden="true">
            {group}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {perms.map((p) => {
              const blocked = !isAllowed(p.key);
              return (
                <label
                  key={p.key}
                  title={blocked ? 'You cannot grant a permission you do not have' : p.description}
                  className={cn('flex min-h-6 cursor-pointer items-center gap-2 text-[13px]', (disabled || blocked) && 'cursor-not-allowed text-ink-subtle')}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-800"
                    checked={value.has(p.key)}
                    disabled={disabled || blocked}
                    onChange={() => onToggle(p.key)}
                    aria-describedby={`perm-${p.key}`}
                  />
                  {p.label}
                  <span id={`perm-${p.key}`} className="sr-only">{p.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({ role, catalog, onBack, onDeleted }) {
  const { can } = useAuth();
  const update = useUpdateRole();
  const remove = useDeleteRole();
  const [draft, setDraft] = useState(() => new Set(role.permissions));
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setDraft(new Set(role.permissions)), [role.permissions]);

  const editable = can('ROLE_UPDATE') && !role.isLocked;
  const dirty = draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p));
  const toggle = (key) =>
    setDraft((d) => {
      const next = new Set(d);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () =>
    update.mutate(
      { id: role.id, permissions: [...draft] },
      { onSuccess: () => toast.success(`${role.name} role saved`), onError: (err) => toast.error(err.message) },
    );

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700 lg:hidden">
            <ArrowLeft size={13} aria-hidden="true" /> All roles
          </button>
          <h2 className="text-[15px] font-semibold">{role.name}</h2>
          <p className="text-[13px] text-ink-muted">{role.description ?? 'No description'}</p>
        </div>
        {!role.isSystem && can('ROLE_DELETE') && (
          <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
            Delete role
          </Button>
        )}
      </div>

      {role.isLocked && (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-md bg-accent-50 px-3 py-2 text-[13px] text-accent-700">
          <Lock size={14} aria-hidden="true" /> Owners always have full access. This role can't be changed.
        </p>
      )}
      {!role.isLocked && !can('ROLE_UPDATE') && <p className="mx-4 mt-3 text-[13px] text-ink-muted">You can view this role but not change it.</p>}

      <div className="px-4">
        <PermissionGrid catalog={catalog} value={role.isLocked ? new Set(catalog.map((p) => p.key)) : draft} onToggle={toggle} disabled={!editable} isAllowed={(k) => can(k)} />
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-2 border-t border-line bg-canvas/60 px-4 py-3">
          <span className="text-xs text-ink-muted">
            {dirty ? 'Unsaved changes — applies to all ' + pluralize(role.memberCount, 'member') + ' with this role.' : `${pluralize(draft.size, 'permission')} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(new Set(role.permissions))}>
              Discard
            </Button>
            <Button variant="primary" size="sm" disabled={!dirty} loading={update.isPending} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the ${role.name} role?`}
        description={role.memberCount ? `${pluralize(role.memberCount, 'member')} still have this role. Move them to another role first.` : 'This custom role will be removed. This cannot be undone.'}
        confirmLabel="Delete role"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(role.id, {
            onSuccess: () => {
              toast.success('Role deleted');
              setConfirmDelete(false);
              onDeleted();
            },
            onError: (err) => {
              setConfirmDelete(false);
              toast.error(err.message);
            },
          })
        }
      />
    </div>
  );
}

function CreateRoleModal({ open, onOpenChange, catalog, onCreated }) {
  const { can } = useAuth();
  const create = useCreateRole();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState(() => new Set(['PROJECT_VIEW', 'TASK_VIEW']));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setPerms(new Set(['PROJECT_VIEW', 'TASK_VIEW']));
      setError(null);
    }
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError({ field: 'name', message: 'Give the role a name (at least 2 characters)' });
    create.mutate(
      { name: name.trim(), description: description.trim() || null, permissions: [...perms] },
      {
        onSuccess: (role) => {
          toast.success(`${role.name} role created`);
          onOpenChange(false);
          onCreated(role);
        },
        onError: (err) => setError(err),
      },
    );
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New role" description="Combine permissions for a responsibility the default roles don't fit." size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            {error && !error.field && <FormAlert>{error.message}</FormAlert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role name" required error={error?.field === 'name' ? error.message : error?.fieldErrors?.name}>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. QA Reviewer" />
              </Field>
              <Field label="Description" optional>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this role for?" />
              </Field>
            </div>
            <div>
              <p className="text-[13px] font-medium">Permissions</p>
              <PermissionGrid
                catalog={catalog}
                value={perms}
                isAllowed={(k) => can(k)}
                onToggle={(key) =>
                  setPerms((d) => {
                    const next = new Set(d);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create role
            </Button>
          </DialogFooter>
        </form>
    </Modal>
  );
}
