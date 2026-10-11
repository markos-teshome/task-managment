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

const RESEND_SECONDS = 60; // matches the server's one-email-a-minute rule

/**
 * Who is recovering: company users (default) or TeamFlow platform admins. Each has its own API, pages,
 * link lifetime and password rule; the screens are shared so both look and behave the same.
 */
const TENANT = {
  forgotEndpoint: '/auth/forgot-password',
  resetEndpoint: '/auth/reset-password',
  loginPath: '/login',
  loginLabel: 'Back to sign in',
  forgotPath: '/forgot-password',
  forgotSubtitle: "Enter your email and we'll send you a secure reset link.",
  linkLifetime: '30 minutes',
  minLength: 8,
  password: rules.password,
};
const PLATFORM = {
  forgotEndpoint: '/platform/auth/forgot-password',
  resetEndpoint: '/platform/auth/reset-password',
  loginPath: '/platform/login',
  loginLabel: 'Back to platform sign-in',
  forgotPath: '/platform/forgot-password',
  forgotSubtitle: "Enter your administrator email address. If an eligible account exists, we'll send you a secure reset link.",
  linkLifetime: '15 minutes',
  minLength: 12,
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .max(72, 'Password is too long')
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and numbers'),
};

const backLink = (v) => (
  <Link to={v.loginPath} className="font-medium text-brand-700 hover:underline">
    {v.loginLabel}
  </Link>
);

/**
 * Step 1 of recovery. The answer is the same whether or not the account exists; after sending, the person can
 * resend once the cooldown has passed (the server enforces the same limit).
 */
function ForgotPasswordView({ v }) {
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
      const res = await api.post(v.forgotEndpoint, { email });
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
      <AuthLayout title="Check your email" footer={backLink(v)}>
        <div className="flex items-start gap-3 rounded-md bg-brand-50 px-3 py-3 text-[13px] text-brand-800" role="status">
          <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{message} The link expires in {v.linkLifetime} and works once.</p>
        </div>
        <p className="mt-4 text-[13px] text-ink-muted">
          Nothing after a few minutes? Check your spam folder and that <span className="font-medium text-ink">{sentTo}</span> is the right address.
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
    <AuthLayout title="Reset your password" subtitle={v.forgotSubtitle} footer={backLink(v)}>
      <form onSubmit={form.handleSubmit(({ email }) => request(email))} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <Field label="Email address" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus placeholder="you@company.com" {...form.register('email')} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

/** A dead link (invalid, expired, used or replaced) — one clear message and one way forward. */
function InvalidLink({ v }) {
  return (
    <AuthLayout title="Link no longer valid" footer={backLink(v)}>
      <div className="flex items-start gap-3 rounded-md border border-line bg-canvas px-3 py-3 text-[13px] text-ink-muted" role="alert">
        <LinkIcon size={18} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <p>This password reset link is invalid or has expired. Please request a new one.</p>
      </div>
      <ButtonLink to={v.forgotPath} variant="primary" className="mt-4 w-full">
        Request new link
      </ButtonLink>
    </AuthLayout>
  );
}

/** Step 2: choose the new password. Success signs out every device and goes to sign-in (never signs in). */
function ResetPasswordView({ v }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState(null);
  const schema = z
    .object({ password: v.password, confirm: z.string().min(1, 'Confirm your new password') })
    .refine((x) => x.password === x.confirm, { path: ['confirm'], message: "Passwords don't match" });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' }, mode: 'onTouched' });
  const password = form.watch('password');

  const onSubmit = async ({ password: value }) => {
    setError(null);
    try {
      const res = await api.post(v.resetEndpoint, { token, password: value });
      navigate(v.loginPath, { replace: true, state: { message: res.message } });
    } catch (err) {
      // Unknown/expired/used token, or a malformed one rejected by validation: the same dead-link screen.
      if (err.code === 'INVALID_TOKEN' || err.details?.some((d) => d.field === 'token')) setInvalid(true);
      else setError(err.message);
    }
  };

  if (invalid) return <InvalidLink v={v} />;
  return (
    <AuthLayout title="Create a new password" subtitle="You'll be signed out on every device, then sign in with the new password." footer={backLink(v)}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <div>
          <Field label="New password" error={form.formState.errors.password?.message}>
            <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
          </Field>
          <PasswordChecklist value={password} minLength={v.minLength} />
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

export const ForgotPasswordPage = () => <ForgotPasswordView v={TENANT} />;
export const ResetPasswordPage = () => <ResetPasswordView v={TENANT} />;
export const PlatformForgotPasswordPage = () => <ForgotPasswordView v={PLATFORM} />;
export const PlatformResetPasswordPage = () => <ResetPasswordView v={PLATFORM} />;
