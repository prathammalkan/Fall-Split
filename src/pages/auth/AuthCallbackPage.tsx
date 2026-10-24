import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { isSafeRedirect } from '../../lib/safeRedirect';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Mail, RefreshCw } from 'lucide-react';

const CB_RESEND_STORAGE_KEY = 'fs_cb_resend_cd';

function getStoredCooldown(): number {
  try {
    const raw = sessionStorage.getItem(CB_RESEND_STORAGE_KEY);
    if (raw) {
      const expiresAt = Number(raw);
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        return Math.ceil((expiresAt - Date.now()) / 1000);
      }
    }
  } catch {
    // Ignore storage unavailability
  }
  return 0;
}

function persistCooldown(seconds: number) {
  try {
    sessionStorage.setItem(CB_RESEND_STORAGE_KEY, String(Date.now() + seconds * 1000));
  } catch {
    // Ignore storage unavailability
  }
}

const SUPPORTED_EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function isSupportedEmailOtpType(type: string | null): type is EmailOtpType {
  return type != null && (SUPPORTED_EMAIL_OTP_TYPES as readonly string[]).includes(type);
}

/**
 * Auth callback handler for OAuth (PKCE), magic links, email verification,
 * and password recovery.
 *
 * Supports:
 * 1. Supabase GoTrue redirects with PKCE ?code=
 * 2. Direct SPA email verification with ?token_hash= &type=
 * 3. Hash fragment error and token payloads (#error=..., #access_token=...)
 * 4. User-friendly expired/invalid link recovery with inline resend
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resendVerificationEmail } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(() => getStoredCooldown());

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    let active = true;
    let handled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    // Parse parameters from both search and hash (Supabase redirects often use hash fragments)
    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(rawHash);

    const errorParam = searchParams.get('error') || hashParams.get('error');
    const errorCode = searchParams.get('error_code') || hashParams.get('error_code');
    const errorDescription =
      searchParams.get('error_description') || hashParams.get('error_description');

    const typeParam = searchParams.get('type') || hashParams.get('type');

    const getDestination = (otpType?: string | null): string => {
      if (otpType === 'recovery' || typeParam === 'recovery') {
        return '/reset-password';
      }
      const queryRedirect = searchParams.get('redirect') || hashParams.get('redirect');
      if (isSafeRedirect(queryRedirect)) {
        return queryRedirect;
      }
      try {
        const stored = sessionStorage.getItem('post_auth_redirect');
        if (stored) {
          sessionStorage.removeItem('post_auth_redirect');
          if (isSafeRedirect(stored)) {
            return stored;
          }
        }
      } catch {
        // Fall back to default
      }
      return '/';
    };

    const completeNavigation = (destination: string) => {
      if (!active || handled) return;
      handled = true;
      if (subscription) subscription.unsubscribe();
      if (timeout) clearTimeout(timeout);
      navigate(destination, { replace: true });
    };

    const displayError = (errorMessage: string, expired = false) => {
      if (!active || handled) return;
      handled = true;
      if (subscription) subscription.unsubscribe();
      if (timeout) clearTimeout(timeout);
      setIsExpired(expired);
      setError(errorMessage);
    };

    // Check for provider or verification error
    if (errorParam || errorCode) {
      const isExpiredOrInvalid =
        errorCode === 'otp_expired' ||
        errorCode === 'invalid_grant' ||
        errorDescription?.toLowerCase().includes('expired') ||
        errorDescription?.toLowerCase().includes('invalid');

      displayError(
        isExpiredOrInvalid
          ? 'This email verification link has expired or has already been used.'
          : (errorDescription ?? 'Authentication could not be completed. Please try again.'),
        isExpiredOrInvalid
      );
      return;
    }

    // Direct token_hash verification flow (e.g. from custom email templates)
    const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');

    if (tokenHash) {
      if (typeParam && !isSupportedEmailOtpType(typeParam)) {
        displayError(
          'Invalid or unsupported verification type. Please check your verification link or try signing in.'
        );
        return;
      }
      const otpType: EmailOtpType =
        typeParam && isSupportedEmailOtpType(typeParam) ? typeParam : 'signup';
      void supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: otpType })
        .then(({ data, error: verifyError }) => {
          if (!active || handled) return;
          if (verifyError) {
            const isExp =
              verifyError.message.toLowerCase().includes('expired') ||
              verifyError.message.toLowerCase().includes('invalid');
            displayError(
              isExp
                ? 'This email verification link has expired or has already been used.'
                : 'Could not verify email. Please try again.',
              isExp
            );
            return;
          }
          if (data.session) {
            completeNavigation(getDestination(otpType));
          } else {
            completeNavigation('/login');
          }
        })
        .catch(() => {
          displayError('Could not verify email. Please try again.');
        });
      return;
    }

    // Check if session is already established
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!active || handled) return;
        if (session) {
          completeNavigation(getDestination(typeParam));
        }
      })
      .catch(() => {
        // Fall through to listener or timeout
      });

    // Listen for SIGNED_IN — fired when Supabase auto-exchanges the PKCE code or implicit token
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || handled) return;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        completeNavigation(getDestination(typeParam));
      }
    });
    subscription = sub.data.subscription;

    const code = searchParams.get('code');

    // Safety timeout
    timeout = setTimeout(
      async () => {
        if (!active || handled) return;
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session) {
            completeNavigation(getDestination(typeParam));
            return;
          }
        } catch {
          // Fall through to error
        }
        if (code) {
          // Code was present but could not be exchanged (e.g. code verifier was on another device/browser or expired)
          displayError(
            'This verification link was opened in a different browser or has expired. If your email was confirmed, you can sign in directly.',
            true
          );
        } else {
          displayError(
            'No authentication details were found. Please check your verification link or try signing in.'
          );
        }
      },
      code ? 6_000 : 1_500
    );

    return () => {
      active = false;
      handled = true;
      if (subscription) subscription.unsubscribe();
      if (timeout) clearTimeout(timeout);
    };
  }, [navigate, searchParams]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToResend = resendEmail.trim();
    if (!emailToResend || resendCooldown > 0 || resendLoading) return;

    setResendLoading(true);
    setResendError(null);
    setResendSuccess(false);

    const queryRedirect = searchParams.get('redirect');
    const redirectTo = isSafeRedirect(queryRedirect) ? queryRedirect : undefined;

    const { error } = await resendVerificationEmail(emailToResend, redirectTo);
    setResendLoading(false);

    if (error) {
      if (error.message?.toLowerCase().includes('rate limit') || error.message?.includes('429')) {
        setResendError('Please wait a moment before requesting another verification email.');
        setResendCooldown(60);
        persistCooldown(60);
      } else {
        setResendError(
          'Could not send verification email. Please check the address and try again.'
        );
      }
      return;
    }

    setResendSuccess(true);
    setResendCooldown(60);
    persistCooldown(60);
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <ErrorMessage message={error} />

          {isExpired && (
            <div className="surface border-border mt-4 rounded-lg border p-4">
              <h2 className="text-secondary mb-1 text-sm font-medium">
                Request a new verification link
              </h2>
              <p className="text-muted mb-3 text-xs">
                Enter your email address to receive a fresh verification link.
              </p>

              {resendSuccess && (
                <p className="mb-3 text-xs text-[rgb(var(--color-positive))]" role="status">
                  A new verification link has been sent! Please check your inbox.
                </p>
              )}
              {resendError && (
                <p className="mb-3 text-xs text-[rgb(var(--color-negative))]" role="alert">
                  {resendError}
                </p>
              )}

              <form onSubmit={handleResend} className="space-y-3" noValidate>
                <div className="relative">
                  <Mail size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="input pl-9 text-sm"
                    aria-label="Email address for verification"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resendLoading || resendCooldown > 0 || !resendEmail.trim()}
                  className="btn-primary flex w-full items-center justify-center gap-2 py-2 text-xs"
                >
                  {resendLoading ? (
                    <>
                      <Spinner size={14} />
                      <span>Sending...</span>
                    </>
                  ) : resendCooldown > 0 ? (
                    <span>Resend in {resendCooldown}s</span>
                  ) : (
                    <>
                      <RefreshCw size={14} />
                      <span>Send new link</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          <button onClick={() => navigate('/login')} className="btn-secondary mt-4 w-full">
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return <LoadingScreen />;
}
