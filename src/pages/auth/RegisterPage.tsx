import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { isSafeRedirect } from '../../lib/safeRedirect';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { LegalLinks } from '../legal/LegalPages';
import { Mail, Lock, User, Eye, EyeOff, RefreshCw } from 'lucide-react';

const REG_RESEND_STORAGE_KEY = 'fs_reg_resend_cd';

function getStoredCooldown(): number {
  try {
    const raw = sessionStorage.getItem(REG_RESEND_STORAGE_KEY);
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
    sessionStorage.setItem(REG_RESEND_STORAGE_KEY, String(Date.now() + seconds * 1000));
  } catch {
    // Ignore storage unavailability
  }
}

const schema = z
  .object({
    displayName: z.string().min(1, 'Name is required').max(60, 'Name too long'),
    email: z.string().email('Enter a valid email address'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[0-9]/, 'Include a number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const { signUp, resendVerificationEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    const rawRedirect = searchParams.get('redirect');
    const redirectTo = isSafeRedirect(rawRedirect) ? rawRedirect : '/';
    if (redirectTo !== '/') {
      try {
        sessionStorage.setItem('post_auth_redirect', redirectTo);
      } catch {
        // The invite remains available in the original link if storage is unavailable.
      }
    }
    const { error } = await signUp(data.email, data.password, data.displayName, redirectTo);
    if (error) {
      if (error.message?.toLowerCase().includes('rate limit') || error.message?.includes('429')) {
        setError('Too many registration attempts. Please wait a moment before trying again.');
      } else {
        // Generic to avoid enumeration
        setError('Could not create account. Please check your details or try signing in.');
      }
      return;
    }
    setRegisteredEmail(data.email);
    setRegistered(true);
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resendLoading || !registeredEmail) return;
    setResendLoading(true);
    setResendError(null);
    setResendSuccess(false);

    const rawRedirect = searchParams.get('redirect');
    const redirectTo = isSafeRedirect(rawRedirect) ? rawRedirect : undefined;

    const { error } = await resendVerificationEmail(registeredEmail, redirectTo);
    setResendLoading(false);

    if (error) {
      if (error.message?.toLowerCase().includes('rate limit') || error.message?.includes('429')) {
        setResendError('Please wait before requesting another verification email.');
        setResendCooldown(60);
        persistCooldown(60);
      } else {
        setResendError('Could not resend verification email. Please try again later.');
      }
      return;
    }

    setResendSuccess(true);
    setResendCooldown(60);
    persistCooldown(60);
  };

  if (registered) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--color-positive)/0.1)]">
            <Mail size={32} className="text-[rgb(var(--color-positive))]" />
          </div>
          <h1 className="text-primary mb-2 text-2xl font-bold">Verify your email</h1>
          <p className="text-secondary mb-2 text-sm">
            We sent a verification link to{' '}
            <strong className="text-primary font-semibold">{registeredEmail}</strong>.
          </p>
          <p className="text-muted mb-4 text-xs">
            Open the link in your email to activate your account and start splitting expenses.
          </p>

          <div className="surface border-border mb-6 rounded-lg border p-4 text-left">
            <p className="text-secondary mb-1 text-xs font-medium">Didn't receive the email?</p>
            <p className="text-muted mb-3 text-xs">
              Check your spam or junk folder. If it hasn't arrived, you can request a new
              verification link.
            </p>

            {resendSuccess && (
              <p className="mb-2 text-xs text-[rgb(var(--color-positive))]" role="status">
                Verification link resent! Please check your inbox.
              </p>
            )}
            {resendError && (
              <p className="mb-2 text-xs text-[rgb(var(--color-negative))]" role="alert">
                {resendError}
              </p>
            )}

            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || resendCooldown > 0}
              className="btn-secondary flex w-full items-center justify-center gap-2 py-2 text-xs"
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
                  <span>Resend verification email</span>
                </>
              )}
            </button>
          </div>

          <button onClick={() => navigate('/login')} className="btn-primary w-full">
            Back to sign in
          </button>
          <div className="mt-8">
            <LegalLinks />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={40} className="mx-auto mb-4" />
          <h1 className="text-primary text-2xl font-bold">Create account</h1>
          <p className="text-muted mt-1 text-sm">Start splitting expenses</p>
        </div>

        {error && <ErrorMessage message={error} />}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="displayName" className="text-secondary mb-1 block text-sm font-medium">
              Name
            </label>
            <div className="relative">
              <User size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
              <input
                {...register('displayName')}
                id="displayName"
                type="text"
                autoComplete="name"
                className="input pl-9"
                placeholder="Your name"
                aria-invalid={!!errors.displayName}
              />
            </div>
            {errors.displayName && (
              <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                {errors.displayName.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="text-secondary mb-1 block text-sm font-medium">
              Email
            </label>
            <div className="relative">
              <Mail size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                className="input pl-9"
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="text-secondary mb-1 block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <Lock size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className="input pr-9 pl-9"
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted absolute top-1/2 right-3 -translate-y-1/2"
                aria-label="Toggle password"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                {errors.password.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="text-secondary mb-1 block text-sm font-medium"
            >
              Confirm password
            </label>
            <div className="relative">
              <Lock size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
              <input
                {...register('confirmPassword')}
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className="input pl-9"
                placeholder="Repeat password"
                aria-invalid={!!errors.confirmPassword}
              />
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size={18} /> : null}
            Create account
          </button>
        </form>

        <p className="text-muted mt-6 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
        <div className="mt-8">
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}
