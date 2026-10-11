import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LinkIcon, MailCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout.jsx';
import { PasswordChecklist, PasswordInput } from './PasswordInput.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { rules } from '../../lib/forms.js';

const backToLogin = (
  <Link to="/login" className="font-medium text-brand-700 hover:underline">
    Back to sign in
  </Link>
);

const RESEND_SECONDS = 60; // matches the server's one-email-a-minute rule

/**
 * Step 1 of recovery. The answer is the same whether or not the account exists; after sending, the person can
 * resend once the cooldown has passed (the server enforces the same limit).
 */
export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState(null);
  const [message, setMessage] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState(null);
  const [resending, setResending] = useState(false);
  const form = useForm({ resolver: zodResolver(z.object({ email: rules.email })), defaultValues: { email: '' } });

  useEffect(() => {
    if (!cooldown) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async (email) => {
    setError(null);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setMessage(res.message);
      setSentTo(email);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err.message);
    }
  };
  const resend = async () => {
    setResending(true);
    await request(sentTo);
    setResending(false);
  };

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={backToLogin}>
        <div className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-3 text-[13px] text-brand-800" role="status">
          <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{message} The link expires in 30 minutes and works once.</p>
        </div>
        <p className="mt-4 text-[13px] text-ink-muted">
          Nothing after a few minutes? Check your spam folder and that <span className="font-medium text-ink">{sentTo}</span> is the address you use for TeamFlow.
        </p>
        <FormAlert className="mt-3">{error}</FormAlert>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={resend} loading={resending} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
          </Button>
          <Button variant="ghost" onClick={() => setSentTo(null)}>Use a different email</Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send you a secure reset link." footer={backToLogin}>
      <form onSubmit={form.handleSubmit(({ email }) => request(email))} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus placeholder="you@company.com" {...form.register('email')} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

const resetSchema = z
  .object({ password: rules.password, confirm: z.string().min(1, 'Confirm your new password') })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

/** A dead link (invalid, expired, used or replaced) — one clear message and one way forward. */
function InvalidLink() {
  return (
    <AuthLayout title="Link no longer valid" footer={backToLogin}>
      <div className="flex items-start gap-3 rounded-md border border-line bg-canvas px-3 py-3 text-[13px] text-ink-muted" role="alert">
        <LinkIcon size={18} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <p>This password reset link is invalid or has expired. Please request a new one.</p>
      </div>
      <ButtonLink to="/forgot-password" variant="primary" className="mt-4 w-full">
        Request new link
      </ButtonLink>
    </AuthLayout>
  );
}

/** Step 2: choose the new password. Success signs out every device and goes to sign-in. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' }, mode: 'onTouched' });
  const password = form.watch('password');

  const onSubmit = async ({ password: value }) => {
    setError(null);
    try {
      const res = await api.post('/auth/reset-password', { token, password: value });
      navigate('/login', { replace: true, state: { message: res.message } });
    } catch (err) {
      // Unknown/expired/used token, or a malformed one rejected by validation: the same dead-link screen.
      if (err.code === 'INVALID_TOKEN' || err.details?.some((d) => d.field === 'token')) setInvalid(true);
      else setError(err.message);
    }
  };

  if (invalid) return <InvalidLink />;
  return (
    <AuthLayout title="Create a new password" subtitle="You'll be signed out on every device, then sign in with the new password." footer={backToLogin}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <div>
          <Field label="New password" error={form.formState.errors.password?.message}>
            <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
          </Field>
          <PasswordChecklist value={password} />
        </div>
        <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
