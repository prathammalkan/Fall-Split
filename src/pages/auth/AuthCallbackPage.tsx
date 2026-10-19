import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

/**
 * Auth callback handler for both OAuth (implicit flow) and magic links.
 *
 * Implicit flow: Supabase returns access_token in the URL hash (#access_token=...).
 * detectSessionInUrl: true makes the client parse the hash automatically and emit
 * a SIGNED_IN event. We just wait for that event and then navigate home.
 *
 * Magic links: same mechanism — Supabase puts tokens in the hash.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Surface any provider-level OAuth error (e.g. user denied access)
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    if (errorParam) {
      setError(errorDescription ?? 'Authentication failed. Please try again.');
      return;
    }

    // Check if a session is already established (e.g. hash was parsed synchronously)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/', { replace: true });
      }
    });

    // Listen for the SIGNED_IN event — fired when Supabase parses the hash tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        subscription.unsubscribe();
        navigate('/', { replace: true });
      }
    });

    // Safety timeout — 12 seconds
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      subscription.unsubscribe();
      if (session) {
        navigate('/', { replace: true });
      } else {
        setError('Sign-in timed out. Please try again.');
      }
    }, 12_000);

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
