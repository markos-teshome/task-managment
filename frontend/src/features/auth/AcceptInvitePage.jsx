import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from './AuthLayout.jsx';
import { PasswordInput } from './PasswordInput.jsx';
import { useAuth } from './AuthProvider.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { api } from '../../lib/api.js';
import { rules } from '../../lib/forms.js';

const newUserSchema = z.object({ firstName: rules.name, lastName: rules.name, password: rules.password });

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { status, reloadMe } = useAuth();
  const [error, setError] = useState(null);

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const inv = invitation.data;
  const form = useForm({
    resolver: zodResolver(inv?.requiresPassword ? newUserSchema : z.object({})),
    values: { firstName: inv?.firstName ?? '', lastName: inv?.lastName ?? '', password: '' },
  });

  const onSubmit = async (values) => {
    setError(null);
    try {
      const result = await api.post('/auth/accept-invitation', { token, ...(inv.requiresPassword ? values : {}) });
      if (status === 'authenticated') {
        await reloadMe();
        navigate('/', { replace: true });
      } else {
        navigate(`/login?email=${encodeURIComponent(result.email)}`, {
          replace: true,
          state: { message: `You've joined ${result.organizationName}. Sign in to get started.` },
        });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  if (!token || invitation.isError) {
    return (
      <AuthLayout title="Invitation not valid">
        <FormAlert>{invitation.error?.message ?? 'This invitation link is incomplete.'}</FormAlert>
        <p className="mt-4 text-[13px] text-ink-muted">
          Ask the person who invited you to send a new invitation, or{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            sign in
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  if (invitation.isLoading) {
    return (
      <AuthLayout title="Loading invitation…">
        <Spinner size={20} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Join ${inv.organizationName}`} subtitle={`You've been invited as ${inv.roleName}. Signing in as ${inv.email}.`}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        {inv.requiresPassword ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" error={form.formState.errors.firstName?.message}>
                <Input autoComplete="given-name" {...form.register('firstName')} />
              </Field>
              <Field label="Last name" error={form.formState.errors.lastName?.message}>
                <Input autoComplete="family-name" {...form.register('lastName')} />
              </Field>
            </div>
            <Field label="Create a password" hint="At least 8 characters, with letters and numbers." error={form.formState.errors.password?.message}>
              <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
            </Field>
          </>
        ) : (
          <p className="text-[13px] text-ink-muted">You already have a TeamFlow account. Accept to add this organization to your workspaces.</p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}
