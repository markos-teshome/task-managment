import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { PasswordInput } from '../auth/PasswordInput.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { api } from '../../lib/api.js';
import { applyServerErrors, rules } from '../../lib/forms.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { ClosureRequest, MembershipActions } from './OrganizationLifecycle.jsx';

/** Settings as labelled sections: description on the left, form on the right (stacked on phones). */
function SettingsSection({ title, description, children }) {
  return (
    <section className="grid gap-4 border-b border-line py-6 first:pt-0 last:border-0 md:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
      </div>
      <div className="max-w-lg">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { workspace, user, can } = useAuth();
  return (
    <>
      <PageHeader title="Settings" description="Your profile, security and organization details." />
      <div>
        <SettingsSection title="Profile" description="How you appear to your team.">
          <ProfileForm />
        </SettingsSection>
        <SettingsSection title="Password" description="Changing your password signs you out of other devices.">
          <PasswordForm />
        </SettingsSection>
        {workspace && (
          <SettingsSection title="Organization" description={can('ORG_MANAGE') ? 'Your organization name is shown to everyone in it.' : 'Ask an owner to change organization details.'}>
            <OrganizationForm />
          </SettingsSection>
        )}
        <SettingsSection title="Your access">
          <dl className="space-y-2 text-[13px]">
            <div className="flex gap-2"><dt className="w-28 text-ink-muted">Email</dt><dd>{user.email}</dd></div>
            {workspace && (
              <>
                <div className="flex gap-2"><dt className="w-28 text-ink-muted">Role</dt><dd><Badge tone="brand">{workspace.role.name}</Badge></dd></div>
                <div className="flex gap-2"><dt className="w-28 text-ink-muted">Plan</dt><dd>{workspace.plan.name}</dd></div>
              </>
            )}
            {user.isPlatformAdmin && <div className="flex gap-2"><dt className="w-28 text-ink-muted">Platform</dt><dd><Badge tone="accent">Super admin</Badge></dd></div>}
          </dl>
        </SettingsSection>
        {workspace && (
          <SettingsSection title="Membership" description={workspace.role.key === 'OWNER' ? 'Hand ownership to someone else, or leave. The last owner must transfer ownership before leaving.' : 'Leave this organization. Your work and history stay with it.'}>
            <MembershipActions />
          </SettingsSection>
        )}
        {workspace?.role.key === 'OWNER' && (
          <SettingsSection title="Close organization" description="Stop using TeamFlow for this organization. Data is kept and closure is reversible.">
            <ClosureRequest />
          </SettingsSection>
        )}
      </div>
    </>
  );
}

function ProfileForm() {
  const { user, reloadMe } = useAuth();
  const form = useForm({
    resolver: zodResolver(z.object({ firstName: rules.name, lastName: rules.name })),
    defaultValues: { firstName: user.firstName, lastName: user.lastName },
  });
  const onSubmit = async (values) => {
    try {
      await api.patch('/auth/me', values);
      await reloadMe();
      form.reset(values);
      toast.success('Profile saved');
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error(err.message);
    }
  };
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={form.formState.errors.firstName?.message}>
          <Input autoComplete="given-name" {...form.register('firstName')} />
        </Field>
        <Field label="Last name" error={form.formState.errors.lastName?.message}>
          <Input autoComplete="family-name" {...form.register('lastName')} />
        </Field>
      </div>
      <Button type="submit" variant="primary" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
        Save profile
      </Button>
    </form>
  );
}

const passwordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: rules.password, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

function PasswordForm() {
  const form = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const onSubmit = async ({ currentPassword, newPassword }) => {
    try {
      const res = await api.post('/auth/change-password', { currentPassword, newPassword });
      form.reset();
      toast.success(res.message);
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error(err.message);
    }
  };
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
        <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password" error={form.formState.errors.newPassword?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
      </div>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Change password
      </Button>
    </form>
  );
}

function OrganizationForm() {
  const { workspace, can, reloadMe } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const editable = can('ORG_MANAGE');
  const form = useForm({
    resolver: zodResolver(z.object({ name: z.string().trim().min(2, 'Name is too short').max(80) })),
    defaultValues: { name: workspace.organization.name },
  });
  const onSubmit = async (values) => {
    setError(null);
    try {
      await api.patch('/organizations/current', values);
      await reloadMe();
      qc.invalidateQueries({ queryKey: ['organization'] });
      form.reset(values);
      toast.success('Organization updated');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormAlert>{error}</FormAlert>
      <Field label="Organization name" error={form.formState.errors.name?.message}>
        <Input {...form.register('name')} disabled={!editable} />
      </Field>
      {editable && (
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
          Save
        </Button>
      )}
    </form>
  );
}
