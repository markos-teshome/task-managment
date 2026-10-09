import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2 } from 'lucide-react';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthProvider.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';

const BLOCKED = {
  MEMBERSHIP_INACTIVE: 'Your access to your organization has been removed. Contact its owner or admin.',
  ORGANIZATION_SUSPENDED: 'Your organization is suspended. Contact TeamFlow support.',
};

/**
 * Shown to signed-in users without a usable workspace: new sign-ups (create one),
 * people who were removed or whose organization is suspended (switch or create).
 */
export function OnboardingPage() {
  const { me, applySession, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(z.object({ name: z.string().trim().min(2, 'Organization name is too short').max(80) })),
    defaultValues: { name: '' },
  });

  const create = async ({ name }) => {
    setError(null);
    try {
      applySession(await api.post('/organizations', { name }));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const switchTo = async (membershipId) => {
    try {
      applySession(await api.post('/auth/switch-workspace', { membershipId }));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  const blocked = BLOCKED[me?.workspaceBlockedReason];

  return (
    <AuthLayout
      title={blocked ? 'Choose a workspace' : `Welcome, ${me?.user.firstName ?? ''}`}
      subtitle={blocked ? undefined : 'Create your organization to start working with your team.'}
      footer={
        <button type="button" onClick={signOut} className="font-medium text-brand-700 hover:underline">
          Sign out
        </button>
      }
    >
      {blocked && <FormAlert className="mb-4">{blocked}</FormAlert>}

      {me?.memberships?.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Your workspaces</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {me.memberships.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => switchTo(m.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-canvas">
                  <span className="font-medium">{m.organization.name}</span>
                  <span className="text-xs text-ink-subtle">{m.roleName}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={form.handleSubmit(create)} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <Field label="Organization name" hint="You can change this later in Settings." error={form.formState.errors.name?.message}>
          <Input placeholder="e.g. Abay Trading PLC" autoFocus autoComplete="organization" {...form.register('name')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" icon={Building2} className="w-full" loading={form.formState.isSubmitting}>
          Create organization
        </Button>
        <p className="text-center text-xs text-ink-subtle">You'll be the owner. Every organization starts on the Free plan.</p>
      </form>
    </AuthLayout>
  );
}
