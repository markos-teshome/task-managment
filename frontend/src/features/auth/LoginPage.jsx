import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { AuthLayout } from './AuthLayout.jsx';
import { PasswordInput } from './PasswordInput.jsx';
import { useAuth } from './AuthProvider.jsx';
import { Field, FormAlert, Input } from '../../components/ui/Form.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { api } from '../../lib/api.js';
import { rules } from '../../lib/forms.js';

const schema = z.object({ email: rules.email, password: z.string().min(1, 'Enter your password') });

export function LoginPage() {
  const { signIn, notice } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [error, setError] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: params.get('email') ?? '', password: '' } });
  const { register, handleSubmit, formState } = form;

  const flash = location.state?.message;

  const onSubmit = async (values) => {
    setError(null);
    try {
      // Redirect is handled by the GuestOnly route guard once the session is set.
      await signIn(values);
    } catch (err) {
      setError(err);
    }
  };

  const resend = async () => {
    await api.post('/auth/resend-verification', { email: form.getValues('email') }).catch(() => {});
    toast.success('Verification email sent. Check your inbox.');
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to TeamFlow."
      footer={
        <>
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {notice === 'expired' && !error && <FormAlert tone="info">Your session expired. Please sign in again.</FormAlert>}
        {flash && !error && <FormAlert tone="success">{flash}</FormAlert>}
        {error && (
          <FormAlert>
            {error.message}
            {error.code === 'EMAIL_NOT_VERIFIED' && (
              <button type="button" onClick={resend} className="mt-1 block font-medium underline underline-offset-2">
                Resend verification email
              </button>
            )}
          </FormAlert>
        )}

        <Field label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>
        <Field
          label="Password"
          error={formState.errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
