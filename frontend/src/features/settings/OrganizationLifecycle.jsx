import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { PasswordInput } from '../auth/PasswordInput.jsx';
import { useMemberOptions, useOrganization } from '../team/api.js';
import { useRoles } from '../roles/api.js';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input, Select, Textarea } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { applyServerErrors, emptyToNull } from '../../lib/forms.js';
import { formatDate } from '../../lib/format.js';

const password = z.string().min(1, 'Enter your password');

/** A modal form that confirms with the person's password; `onDone` gets the API response. */
function PasswordModal({ open, onOpenChange, title, description, schema, defaultValues, submitLabel, tone = 'danger', request, onDone, children }) {
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues });
  const close = (next) => {
    if (!next) {
      form.reset();
      setError(null);
    }
    onOpenChange(next);
  };
  const onSubmit = async (values) => {
    setError(null);
    try {
      const res = await request(values);
      close(false);
      onDone(res);
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(err.message);
    }
  };
  return (
    <Modal open={open} onOpenChange={close} title={title} description={description}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <FormAlert>{error}</FormAlert>
          {children(form)}
          <Field label="Your password" error={form.formState.errors.password?.message}>
            <PasswordInput autoComplete="current-password" {...form.register('password')} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" variant={tone} loading={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

/** D-7: owners hand over ownership; anyone may leave (except the last owner). */
export function MembershipActions() {
  const { workspace, applySession } = useAuth();
  const navigate = useNavigate();
  const isOwner = workspace.role.key === 'OWNER';
  const [transferring, setTransferring] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const members = useMemberOptions();
  const roles = useRoles(isOwner);
  const others = (members.data ?? []).filter((m) => m.id !== workspace.membershipId);
  const stepDownRoles = (roles.data ?? []).filter((r) => r.key !== 'OWNER');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {isOwner && <Button onClick={() => setTransferring(true)}>Transfer ownership…</Button>}
        <Button variant="secondary" onClick={() => setLeaving(true)}>Leave organization…</Button>
      </div>

      <PasswordModal
        open={transferring}
        onOpenChange={setTransferring}
        title="Transfer ownership"
        description="The person you choose becomes an Owner. You can stay an Owner or step down to another role."
        schema={z.object({ membershipId: z.string().min(1, 'Choose a member'), newRoleId: z.string().optional(), password })}
        defaultValues={{ membershipId: '', newRoleId: '', password: '' }}
        submitLabel="Transfer ownership"
        tone="primary"
        request={(v) => api.post('/organizations/current/ownership', { ...v, newRoleId: emptyToNull(v.newRoleId) })}
        onDone={(res) => {
          applySession(res);
          toast.success('Ownership transferred');
        }}
      >
        {(form) => (
          <>
            <Field label="New owner" error={form.formState.errors.membershipId?.message}>
              <Select {...form.register('membershipId')}>
                <option value="">Choose a member</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Your role afterwards" error={form.formState.errors.newRoleId?.message}>
              <Select {...form.register('newRoleId')}>
                <option value="">Stay an Owner</option>
                {stepDownRoles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </PasswordModal>

      <PasswordModal
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${workspace.organization.name}?`}
        description="You lose access straight away. Your tasks and history stay with the organization, and you stop being a branch manager or project lead. An admin can invite you back."
        schema={z.object({ password })}
        defaultValues={{ password: '' }}
        submitLabel="Leave organization"
        request={(v) => api.post('/organizations/current/leave', v)}
        onDone={(res) => {
          applySession(res);
          toast.success(`You left ${workspace.organization.name}`);
          navigate('/', { replace: true });
        }}
      >
        {() => null}
      </PasswordModal>
    </div>
  );
}

/** D-9: owners request closure; the platform closes it after the paid period. Nothing is deleted. */
export function ClosureRequest() {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const org = useOrganization();
  const [requesting, setRequesting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const pending = org.data?.closureRequest;
  const name = workspace.organization.name;

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await api.delete('/organizations/current/closure');
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Closure request withdrawn');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWithdrawing(false);
    }
  };

  if (org.isLoading) return null;
  return pending ? (
    <div className="space-y-3">
      <p className="rounded-md border border-line bg-warning-50 px-3 py-2 text-[13px] text-warning-700">
        Closure requested on {formatDate(pending.requestedAt)}. The subscription won't renew; the platform team will close the organization. You can withdraw until then.
      </p>
      <Button loading={withdrawing} onClick={withdraw}>Withdraw closure request</Button>
    </div>
  ) : (
    <>
      <Button variant="danger" onClick={() => setRequesting(true)}>Request closure…</Button>
      <PasswordModal
        open={requesting}
        onOpenChange={setRequesting}
        title="Request organization closure"
        description="The subscription stops renewing and the platform team closes the organization. Its data is kept, and closure can be reversed by contacting support."
        schema={z.object({
          reason: z.string().max(500).optional(),
          confirmName: z.string().refine((v) => v.trim() === name, 'Type the organization name exactly'),
          password,
        })}
        defaultValues={{ reason: '', confirmName: '', password: '' }}
        submitLabel="Request closure"
        request={(v) => api.post('/organizations/current/closure', { ...v, reason: emptyToNull(v.reason) })}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['organization'] });
          toast.success('Closure requested');
        }}
      >
        {(form) => (
          <>
            <Field label="Reason" optional>
              <Textarea rows={2} {...form.register('reason')} />
            </Field>
            <Field label={`Type “${name}” to confirm`} error={form.formState.errors.confirmName?.message}>
              <Input autoComplete="off" {...form.register('confirmName')} />
            </Field>
          </>
        )}
      </PasswordModal>
    </>
  );
}
