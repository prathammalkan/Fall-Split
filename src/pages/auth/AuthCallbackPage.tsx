import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Surface any OAuth error returned by the provider
    if (errorParam) {
      setError(errorDescription ?? 'Authentication failed. Please try again.');
      return;
    }

    // Supabase client (with detectSessionInUrl: true + flowType: 'pkce') automatically
    // exchanges the ?code= for a session when it sees it in the URL.
    // We just need to wait for the AUTH_CODE_EXCHANGED / SIGNED_IN event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true });
      } else if (event === 'TOKEN_REFRESHED' && session) {
        navigate('/', { replace: true });
      }
    });

    // Fallback: if a session already exists (e.g. the code was exchanged synchronously
    // before our listener was attached), navigate immediately.
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) {
        setError('Failed to complete sign-in. Please try again.');
        return;
      }
      if (session) {
        navigate('/', { replace: true });
      }
    });

    // Safety timeout — if nothing resolves in 10 s, show an error
    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
          setError('Sign-in timed out. Please try again.');
        }
      });
    }, 10_000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <ErrorMessage message={error} />
          <button onClick={() => navigate('/login')} className="btn-secondary w-full mt-4">
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return <LoadingScreen />;
}
