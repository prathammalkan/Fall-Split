import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getCooldownRemainingSeconds, setCooldownSeconds } from '../../lib/rateLimiter';
import { Logo } from '../../components/brand/Logo';
import { Spinner } from '../../components/ui/Spinner';

const VERIFY_RESEND_KEY = 'fs_verify_resend_cd';

export function VerifyEmailPage() {
  const { user, resendVerificationEmail, signOut } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() => getCooldownRemainingSeconds(VERIFY_RESEND_KEY));

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!user?.email || sending || cooldown > 0) return;
    setSending(true);
    setError(null);
    setSent(false);
    const { error: resendErr } = await resendVerificationEmail(user.email);
    setSending(false);
    if (resendErr) {
      setError('Could not resend verification email right now. Please try again shortly.');
      setCooldownSeconds(VERIFY_RESEND_KEY, 60);
      setCooldown(60);
      return;
    }
    setSent(true);
    setCooldownSeconds(VERIFY_RESEND_KEY, 60);
    setCooldown(60);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Logo size={40} className="mx-auto mb-6" />
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--color-accent)/0.1)]">
          <Mail size={32} className="text-[rgb(var(--color-accent))]" />
        </div>
        <h1 className="text-primary mb-2 text-2xl font-bold">Verify your email</h1>
        <p className="text-secondary mb-6 text-sm">
          Please verify your email address{user?.email ? ` (${user.email})` : ''} before using Fall
          Split. Check your inbox for a verification link.
        </p>

        {sent && (
          <p className="mb-3 text-xs text-[rgb(var(--color-positive))]" role="status">
            Verification email sent! Please check your inbox.
          </p>
        )}
        {error && (
          <p className="mb-3 text-xs text-[rgb(var(--color-negative))]" role="alert">
            {error}
          </p>
        )}

        {user?.email ? (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={sending || cooldown > 0}
              className="btn-primary w-full"
            >
              {sending ? (
                <Spinner size={16} />
              ) : cooldown > 0 ? (
                `Resend in ${cooldown}s`
              ) : (
                <>
                  <RefreshCw size={16} /> Resend verification email
                </>
              )}
            </button>
            <button type="button" onClick={() => void signOut()} className="btn-secondary w-full">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        ) : (
          <Link to="/login" className="btn-secondary block w-full text-center">
            Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}
