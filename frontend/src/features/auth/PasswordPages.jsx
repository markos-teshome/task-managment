import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout.jsx';
import { PasswordInput } from './PasswordInput.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { rules } from '../../lib/forms.js';

const backToLogin = (
  <Link to="/login" className="font-medium text-brand-700 hover:underline">
    Back to sign in
  </Link>
);

export function ForgotPasswordPage() {
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(z.object({ email: rules.email })), defaultValues: { email: '' } });

  const onSubmit = async ({ email }) => {
    setError(null);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send you a reset link." footer={backToLogin}>
      {message ? (
        <>
          <div className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-3 text-[13px] text-brand-800">
            <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>{message} The link expires in 1 hour.</p>
          </div>
        </>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormAlert>{error}</FormAlert>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

const resetSchema = z
  .object({ password: rules.password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [error, setError] = useState(token ? null : 'This reset link is incomplete. Request a new one.');
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = async ({ password }) => {
    setError(null);
    try {
      const res = await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true, state: { message: res.message } });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out of all other devices." footer={backToLogin}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && (
          <FormAlert>
            {error}{' '}
            <Link to="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </FormAlert>
        )}
        <Field label="New password" hint="At least 8 characters, with letters and numbers." error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting} disabled={!token}>
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
