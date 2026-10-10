import { useState } from 'react';
import { toast } from 'sonner';
import { useBranches, useUpdateBranch } from './api.js';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Select } from '../../components/ui/Form.jsx';
import { isPlanLimitError } from '../../lib/api.js';
import { PlanLimitNotice } from '../../components/feedback/States.jsx';

/**
 * Archive (deactivate) a branch. Nothing is deleted: archived projects and branch members keep their link.
 * Active projects must go somewhere first — another active branch or organization-wide — and the server
 * refuses otherwise (its message is shown as-is).
 */
export function ArchiveBranchDialog({ branch, onClose, onArchived }) {
  const update = useUpdateBranch(branch?.id);
  const others = useBranches({ status: 'ACTIVE' }, { enabled: !!branch && branch.activeProjectCount > 0 });
  const [target, setTarget] = useState('');
  const [error, setError] = useState(null);
  const needsTarget = branch?.activeProjectCount > 0;

  const confirm = () => {
    setError(null);
    const body = { status: 'INACTIVE', ...(needsTarget && { reassignProjectsTo: target === 'org' ? null : target }) };
    update.mutate(body, {
      onSuccess: () => {
        toast.success(`${branch.name} archived`);
        onArchived?.();
        onClose();
      },
      onError: setError,
    });
  };

  return (
    <ConfirmDialog
      open={!!branch}
      onOpenChange={(open) => !open && onClose()}
      title={`Archive ${branch?.name}?`}
      description="The branch stops accepting new members and projects. Nothing is deleted: its history, archived projects and member list are kept, and you can reactivate it later."
      confirmLabel="Archive branch"
      loading={update.isPending}
      onConfirm={() => (!needsTarget || target) && confirm()}
    >
      <div className="mt-3 space-y-3">
        <FormAlert>{error?.message}</FormAlert>
        {needsTarget && (
          <Field
            label={`Move its ${branch.activeProjectCount} active project${branch.activeProjectCount === 1 ? '' : 's'} to`}
            required
            hint="Project teams and tasks stay as they are."
          >
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              <option value="org">Organization-wide (no branch)</option>
              {(others.data ?? [])
                .filter((b) => b.id !== branch.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
    </ConfirmDialog>
  );
}

/** Reactivate an archived branch (counts against the plan's branch limit again). */
export function ReactivateBranchDialog({ branch, onClose }) {
  const update = useUpdateBranch(branch?.id);
  const [error, setError] = useState(null);
  return (
    <ConfirmDialog
      open={!!branch}
      onOpenChange={(open) => !open && (setError(null), onClose())}
      title={`Reactivate ${branch?.name}?`}
      description="It becomes available for members and projects again, and counts towards your plan's branch limit."
      confirmLabel="Reactivate"
      tone="primary"
      loading={update.isPending}
      onConfirm={() =>
        update.mutate({ status: 'ACTIVE' }, { onSuccess: () => (toast.success(`${branch.name} reactivated`), onClose()), onError: setError })
      }
    >
      {error && (isPlanLimitError(error) ? <PlanLimitNotice className="mt-3" code={error.code} message={error.message} /> : <FormAlert className="mt-3">{error.message}</FormAlert>)}
    </ConfirmDialog>
  );
}
