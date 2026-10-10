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
const existingUserSchema = z.object({ password: z.string().min(1, 'Enter your password') });

const INVALID_TITLES = {
  INVITATION_EXPIRED: 'This invitation has expired',
  INVITATION_ALREADY_ACCEPTED: 'Invitation already accepted',
};
const UNREACHABLE = ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE'];

/** Organization, inviter, role and address at a glance, before anyone types anything. */
function InvitationSummary({ inv }) {
  const rows = [
    ['Organization', inv.organizationName],
    ...(inv.inviterName ? [['Invited by', inv.inviterName]] : []),
    ['Role', inv.roleName],
    ['Invitation for', inv.email],
  ];
  return (
    <dl className="mb-5 divide-y divide-line rounded-md border border-line text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 truncate font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The invitation decides the organization and role; the person only confirms who they are:
 *  - new person → name + new password (creates and verifies the account);
 *  - existing account → their current password, or nothing if already signed in as that account;
 *  - signed in as someone else → asked to sign out first (the API refuses it anyway).
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { status, user, reloadMe, signOut } = useAuth();
  const [error, setError] = useState(null);

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const inv = invitation.data;
  const signedIn = status === 'authenticated';
  const wrongAccount = signedIn && inv && user?.email !== inv.email;
  const needsCurrentPassword = inv && !inv.requiresPassword && !signedIn;

  const form = useForm({
    resolver: zodResolver(inv?.requiresPassword ? newUserSchema : needsCurrentPassword ? existingUserSchema : z.object({})),
    values: { firstName: inv?.firstName ?? '', lastName: inv?.lastName ?? '', password: '' },
  });

  const onSubmit = async (values) => {
    setError(null);
    try {
      const body = inv.requiresPassword ? values : needsCurrentPassword ? { password: values.password } : {};
      const result = await api.post('/auth/accept-invitation', { token, ...body });
      if (signedIn) {
        await reloadMe();
        navigate('/', { replace: true });
      } else {
        navigate(`/login?email=${encodeURIComponent(result.email)}`, {
          replace: true,
          state: { message: `You've joined ${result.organizationName}. Sign in to get started.` },
        });
      }
    } catch (err) {
      if (err.fieldErrors?.password) form.setError('password', { message: err.fieldErrors.password });
      else setError(err.message);
    }
  };

  if (invitation.isError && UNREACHABLE.includes(invitation.error.code)) {
    return (
      <AuthLayout title="We couldn't open your invitation">
        <FormAlert>{invitation.error.message}</FormAlert>
        <p className="mt-3 text-[13px] text-ink-muted">Your invitation is still valid. Check your connection and try again.</p>
        <Button variant="primary" size="lg" className="mt-4 w-full" loading={invitation.isFetching} onClick={() => invitation.refetch()}>
          Try again
        </Button>
      </AuthLayout>
    );
  }

  if (!token || invitation.isError) {
    const code = invitation.error?.code;
    return (
      <AuthLayout title={INVALID_TITLES[code] ?? 'Invitation not valid'}>
        <FormAlert>{invitation.error?.message ?? 'This invitation link is incomplete.'}</FormAlert>
        <p className="mt-4 text-[13px] text-ink-muted">
          {code === 'INVITATION_ALREADY_ACCEPTED' ? 'You can ' : 'Ask the person who invited you to send a new invitation, or '}
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
    <AuthLayout title={`You're invited to join ${inv.organizationName}`} subtitle="Accept to start working with your team on TeamFlow.">
      <InvitationSummary inv={inv} />
      {wrongAccount ? (
        <div className="space-y-4">
          <FormAlert>
            You're signed in as {user.email}, but this invitation was sent to {inv.email}. Sign out, then open the link again.
          </FormAlert>
          <Button variant="primary" size="lg" className="w-full" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormAlert>{error}</FormAlert>
          {inv.requiresPassword && (
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
          )}
          {needsCurrentPassword && (
            <>
              <p className="text-[13px] text-ink-muted">You already have a TeamFlow account. Enter its password to add this organization to your workspaces.</p>
              <Field label="Your password" error={form.formState.errors.password?.message}>
                <PasswordInput autoComplete="current-password" autoFocus {...form.register('password')} />
              </Field>
              <p className="text-[13px]">
                <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
                  Forgot your password?
                </Link>
              </p>
            </>
          )}
          {!inv.requiresPassword && signedIn && (
            <p className="text-[13px] text-ink-muted">Accept to add this organization to your workspaces.</p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Accept invitation
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
