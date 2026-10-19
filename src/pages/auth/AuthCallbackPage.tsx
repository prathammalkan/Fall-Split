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
    const handleCallback = async () => {
      const errorParam = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      const code = searchParams.get('code');

      // Provider-level error (e.g. user denied)
      if (errorParam) {
        setError(errorDescription ?? 'Authentication failed. Please try again.');
        return;
      }

      // Step 1: check if Supabase already exchanged the code automatically
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession) {
        navigate('/', { replace: true });
        return;
      }

      // Step 2: exchange manually (PKCE — code_verifier is in localStorage)
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          // If code was already consumed (double-call), check for a session one more time
          if (
            exchangeError.message?.includes('already') ||
            exchangeError.message?.includes('expired') ||
            exchangeError.message?.includes('invalid')
          ) {
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession) {
              navigate('/', { replace: true });
              return;
            }
          }
          console.error('[AuthCallback] exchangeCodeForSession error:', exchangeError);
          setError(`Sign-in failed: ${exchangeError.message}. Please try again.`);
          return;
        }

        if (data.session) {
          navigate('/', { replace: true });
          return;
        }
      }

      // Step 3: no code in URL — wait for auth state change (e.g. magic link hash)
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
          subscription.unsubscribe();
          navigate('/', { replace: true });
        }
      });

      // Final timeout fallback
      setTimeout(async () => {
        const { data: { session: finalSession } } = await supabase.auth.getSession();
        if (finalSession) {
          subscription.unsubscribe();
          navigate('/', { replace: true });
        } else {
          subscription.unsubscribe();
          setError('Sign-in timed out. Please try again.');
        }
      }, 8_000);
    };

    void handleCallback();
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
