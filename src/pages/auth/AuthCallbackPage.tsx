import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

/**
 * Auth callback handler for OAuth (PKCE) and magic links.
 *
 * With flowType: 'pkce' + detectSessionInUrl: true, Supabase automatically
 * exchanges the ?code= param using the code_verifier stored in localStorage.
 * This works correctly because signInWithOAuth now uses window.location.origin
 * as the redirectTo, ensuring the callback returns to the SAME origin where
 * the code_verifier was stored.
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

    const getDestination = (): string => {
      try {
        const stored = sessionStorage.getItem('post_auth_redirect');
        if (stored) {
          sessionStorage.removeItem('post_auth_redirect');
          if (stored.startsWith('/') && !stored.startsWith('//')) {
            return stored;
          }
        }
      } catch {
        // Fall back to default
      }
      return '/';
    };

    // Check if Supabase (detectSessionInUrl: true) already exchanged the code
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate(getDestination(), { replace: true });
      }
    });

    // Listen for SIGNED_IN — fired when Supabase auto-exchanges the PKCE code
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        subscription.unsubscribe();
        navigate(getDestination(), { replace: true });
      }
    });

    // Safety timeout
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      subscription.unsubscribe();
      if (session) {
        navigate(getDestination(), { replace: true });
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
