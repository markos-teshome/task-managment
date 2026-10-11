import { createContext, useContext, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../auth/AuthLayout.jsx';
import { PasswordInput } from '../auth/PasswordInput.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { SplashScreen } from '../../components/feedback/PageLoader.jsx';
import { api } from '../../lib/api.js';
import { rules } from '../../lib/forms.js';

/*
 * Platform console authentication — separate from the tenant app: its own sign-in (password, then an
 * emailed 6-digit code) and its own session cookie, which the browser only sends to /api/v1/platform.
 */

const PlatformContext = createContext(null);
export const usePlatformAdmin = () => useContext(PlatformContext);

const ME_KEY = ['platform', 'me'];

/** Guard for /platform/*: loads the platform session, or sends the visitor to the platform sign-in. */
export function RequirePlatformSession() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => api.get('/platform/auth/me'), retry: false, staleTime: 60_000 });
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (me.isLoading) return <SplashScreen message="Opening the platform console…" />;
  if (me.isError) return <Navigate to="/platform/login" replace />;
  const signOut = async () => {
    await api.post('/platform/auth/logout').catch(() => {});
    qc.removeQueries({ queryKey: ['platform'] });
    navigate('/platform/login', { replace: true });
  };
  return (
    <PlatformContext.Provider value={{ admin: me.data.admin, signOut }}>
      <Outlet />
    </PlatformContext.Provider>
  );
}

const credentialsSchema = z.object({ email: rules.email, password: z.string().min(1, 'Enter your password') });
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email') });

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const flash = useLocation().state?.message; // e.g. after a password reset
  const qc = useQueryClient();
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const credentials = useForm({ resolver: zodResolver(credentialsSchema), defaultValues: { email: '', password: '' } });
  const codeForm = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  const start = async (values) => {
    setError(null);
    try {
      setChallenge(await api.post('/platform/auth/login', values));
    } catch (err) {
      setError(err.message);
    }
  };

  const verify = async ({ code }) => {
    setError(null);
    try {
      await api.post('/platform/auth/verify', { challengeId: challenge.challengeId, code });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/platform', { replace: true });
    } catch (err) {
      if (err.code === 'INVALID_CODE' && /expired|Sign in again/.test(err.message)) setChallenge(null);
      setError(err.message);
    }
  };

  if (challenge) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a 6-digit sign-in code to ${challenge.sentTo}. It expires in 10 minutes.`}>
        <form onSubmit={codeForm.handleSubmit(verify)} noValidate className="space-y-4">
          <FormAlert>{error}</FormAlert>
          <Field label="Sign-in code" error={codeForm.formState.errors.code?.message}>
            <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="tracking-[0.4em]" {...codeForm.register('code')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={codeForm.formState.isSubmitting}>
            Verify and sign in
          </Button>
          <button type="button" className="w-full text-center text-[13px] font-medium text-brand-700 hover:underline" onClick={() => setChallenge(null)}>
            Start again
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Platform console" subtitle="For TeamFlow administrators. Company accounts sign in on the main page.">
      <form onSubmit={credentials.handleSubmit(start)} noValidate className="space-y-4">
        {flash && !error && <FormAlert tone="success">{flash}</FormAlert>}
        <FormAlert>{error}</FormAlert>
        <Field label="Email" error={credentials.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...credentials.register('email')} />
        </Field>
        <Field
          label="Password"
          error={credentials.formState.errors.password?.message}
          labelAction={
            <Link to="/platform/forgot-password" className="text-[12.5px] font-medium text-brand-700 hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...credentials.register('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={credentials.formState.isSubmitting}>
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
