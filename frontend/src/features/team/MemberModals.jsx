import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useInviteMember, useUpdateMember } from './api.js';
import { Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { Field, FormAlert, Input, Select } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PlanLimitNotice } from '../../components/feedback/States.jsx';
import { applyServerErrors, emptyToNull, rules } from '../../lib/forms.js';
import { isPlanLimitError } from '../../lib/api.js';

/** Roles the current user may hand out: never Owner unless they are an owner (API enforces the same). */
function useAssignableRoles(roles) {
  const { workspace } = useAuth();
  return roles.filter((r) => r.key !== 'OWNER' || workspace.role.key === 'OWNER');
}

const inviteSchema = z.object({
  email: rules.email,
  firstName: rules.name,
  lastName: rules.name,
  roleId: z.string().min(1, 'Choose a role'),
  jobTitle: z.string().max(80).optional(),
});

export function InviteMemberModal({ open, onOpenChange, roles, organization }) {
  const { workspace } = useAuth();
  const invite = useInviteMember();
  const assignable = useAssignableRoles(roles);
  const [error, setError] = useState(null);
  const defaultRole = assignable.find((r) => r.key === 'EMPLOYEE')?.id ?? '';
  const form = useForm({
    resolver: zodResolver(inviteSchema),
    values: open ? { email: '', firstName: '', lastName: '', roleId: defaultRole, jobTitle: '' } : undefined,
  });

  const atLimit = organization && organization.plan.maxUsers !== null && organization.usage.users >= organization.plan.maxUsers;

  const close = (next) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  const onSubmit = (values) => {
    setError(null);
    invite.mutate(
      { ...values, jobTitle: emptyToNull(values.jobTitle) },
      {
        onSuccess: (m) => {
          if (m.emailSent) toast.success(`Invitation sent to ${m.email}`);
          else toast.warning(`${m.name} was added, but the invitation email couldn't be sent. Use “Resend invitation” from the team list.`, { duration: 8000 });
          close(false);
        },
        onError: (err) => !applyServerErrors(form, err) && setError(err),
      },
    );
  };

  const selectedRole = roles.find((r) => r.id === form.watch('roleId'));

  return (
    <Modal open={open} onOpenChange={close} title="Invite a team member" description="They'll get an email with a link to join your organization.">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {organization && (
            <p className="text-xs text-ink-muted">
              Seats: <span className="font-medium tabular-nums text-ink">{organization.usage.users}</span>
              {organization.plan.maxUsers !== null && <span className="tabular-nums"> / {organization.plan.maxUsers}</span>} used on the {organization.plan.name} plan
            </p>
          )}
          {atLimit ? (
            <PlanLimitNotice
              code="SUBSCRIPTION_USER_LIMIT"
              message={`Your ${organization.plan.name} plan supports up to ${organization.plan.maxUsers} team members. Upgrade your plan to add more people.`}
            />
          ) : error && isPlanLimitError(error) ? (
            <PlanLimitNotice code={error.code} message={error.message} />
          ) : (
            <FormAlert>{error?.message}</FormAlert>
          )}
          <Field label="Email" required error={form.formState.errors.email?.message}>
            <Input type="email" autoFocus autoComplete="off" placeholder="name@company.com" {...form.register('email')} disabled={atLimit} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required error={form.formState.errors.firstName?.message}>
              <Input {...form.register('firstName')} disabled={atLimit} />
            </Field>
            <Field label="Last name" required error={form.formState.errors.lastName?.message}>
              <Input {...form.register('lastName')} disabled={atLimit} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" required error={form.formState.errors.roleId?.message}>
              <Select {...form.register('roleId')} disabled={atLimit}>
                <option value="">Choose a role</option>
                {assignable.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Job title" optional>
              <Input placeholder="e.g. Site engineer" {...form.register('jobTitle')} disabled={atLimit} />
            </Field>
          </div>
          {selectedRole?.description && <p className="-mt-2 text-xs text-ink-subtle">{selectedRole.name}: {selectedRole.description}</p>}
          {!atLimit && selectedRole && (
            <div className="rounded-md border border-line bg-canvas px-3 py-2 text-[13px]" aria-live="polite">
              <span className="text-ink-muted">Review: </span>
              <span className="font-medium">{form.watch('email') || 'This person'}</span>
              <span className="text-ink-muted"> will join </span>
              <span className="font-medium">{workspace.organization.name}</span>
              <span className="text-ink-muted"> as </span>
              <span className="font-medium">{selectedRole.name}</span>
              <span className="text-ink-muted">. The link is valid for 7 days.</span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" loading={invite.isPending} disabled={atLimit}>
            Send invitation
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

export function ChangeRoleModal({ member, onClose, roles }) {
  const update = useUpdateMember();
  const assignable = useAssignableRoles(roles);
  const [roleId, setRoleId] = useState('');
  useEffect(() => setRoleId(member?.role.id ?? ''), [member]);
  const role = roles.find((r) => r.id === roleId);

  const save = () =>
    update.mutate(
      { id: member.id, roleId },
      {
        onSuccess: () => {
          toast.success(`${member.name} is now ${role.name}`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <Modal open={!!member} onOpenChange={(open) => !open && onClose()} title="Change role" description={member ? `${member.name} · ${member.email}` : undefined} size="sm">
      <DialogBody className="space-y-3">
        <Field label="Role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        {role && <p className="text-xs text-ink-muted">{role.description ?? `${role.permissions.length} permissions`}</p>}
        <p className="text-xs text-ink-subtle">The change applies immediately, even if they are signed in.</p>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button variant="primary" loading={update.isPending} disabled={!member || roleId === member?.role.id} onClick={save}>
          Save role
        </Button>
      </DialogFooter>
    </Modal>
  );
}
