import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from './AuthLayout.jsx';
import { PasswordChecklist, PasswordInput } from './PasswordInput.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { applyServerErrors, rules } from '../../lib/forms.js';

const schema = z.object({ firstName: rules.name, lastName: rules.name, email: rules.email, password: rules.password });

export function RegisterPage() {
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { firstName: '', lastName: '', email: '', password: '' } });
  const { register, handleSubmit, formState, watch } = form;

  const onSubmit = async (values) => {
    setError(null);
    try {
      await api.post('/auth/register', values);
      setSentTo(values.email);
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(err.message);
    }
  };

  if (sentTo) return <CheckEmail email={sentTo} />;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start organizing your team's projects in minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={formState.errors.firstName?.message}>
            <Input autoComplete="given-name" autoFocus {...register('firstName')} />
          </Field>
          <Field label="Last name" error={formState.errors.lastName?.message}>
            <Input autoComplete="family-name" {...register('lastName')} />
          </Field>
        </div>
        <Field label="Work email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <div>
          <Field label="Password" error={formState.errors.password?.message}>
            <PasswordInput autoComplete="new-password" {...register('password')} />
          </Field>
          <PasswordChecklist value={watch('password')} />
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-xs text-ink-subtle">You'll set up your organization after confirming your email.</p>
      </form>
    </AuthLayout>
  );
}

function CheckEmail({ email }) {
  const [sending, setSending] = useState(false);
  const resend = async () => {
    setSending(true);
    await api.post('/auth/resend-verification', { email }).catch(() => {});
    setSending(false);
    toast.success('If the account needs verification, a new link is on its way.');
  };
  return (
    <AuthLayout title="Check your email" subtitle={`We sent a verification link to ${email}.`}>
      <div className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-3 text-[13px] text-brand-800">
        <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>Open the link in the email to activate your account. It expires in 24 hours.</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" loading={sending} onClick={resend}>
          Resend email
        </Button>
        <Link to="/login" className="text-[13px] font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
