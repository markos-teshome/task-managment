import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthLayout } from './AuthLayout.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { Spinner } from '../../components/ui/Misc.jsx';
import { api } from '../../lib/api.js';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState({ status: token ? 'verifying' : 'error', message: 'This verification link is incomplete.' });
  const started = useRef(false); // tokens are single-use: never submit twice (e.g. StrictMode re-run)

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setState({ status: 'done' }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [token]);

  if (state.status === 'verifying') {
    return (
      <AuthLayout title="Verifying your email…">
        <Spinner size={20} />
      </AuthLayout>
    );
  }

  if (state.status === 'done') {
    return (
      <AuthLayout title="Email verified">
        <div className="flex items-start gap-2 text-[13px] text-ink-muted">
          <CheckCircle2 size={18} className="shrink-0 text-success-600" aria-hidden="true" />
          Your account is active. Sign in to set up your organization.
        </div>
        <ButtonLink to="/login" variant="primary" size="lg" className="mt-5 w-full">
          Continue to sign in
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Link not valid">
      <div className="flex items-start gap-2 text-[13px] text-ink-muted">
        <XCircle size={18} className="shrink-0 text-danger-600" aria-hidden="true" />
        {state.message}
      </div>
      <p className="mt-4 text-[13px] text-ink-muted">
        Try signing in — if your email still needs verification you can request a new link there.{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Go to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
