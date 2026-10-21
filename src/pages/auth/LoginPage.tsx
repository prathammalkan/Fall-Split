import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const { signInWithEmail, signInWithMagicLink, signInWithGoogle, signInWithApple } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  const rawRedirect = searchParams.get('redirect');
  const redirectTo = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    const { error } = await signInWithEmail(data.email, data.password);
    if (error) {
      // Generic message to avoid account enumeration
      setError('Invalid email or password. Please try again.');
      return;
    }
    navigate(redirectTo, { replace: true });
  };

  const saveRedirectForPostAuth = () => {
    if (redirectTo && redirectTo !== '/') {
      try {
        sessionStorage.setItem('post_auth_redirect', redirectTo);
      } catch {
        // Ignore storage exceptions in restricted environments
      }
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicEmail) return;
    saveRedirectForPostAuth();
    setMagicLoading(true);
    setError(null);
    const { error } = await signInWithMagicLink(magicEmail, redirectTo);
    setMagicLoading(false);
    if (error) {
      setError('Could not send magic link. Try again.');
      return;
    }
    setMagicLinkSent(true);
  };

  const handleGoogle = async () => {
    saveRedirectForPostAuth();
    setGoogleLoading(true);
    setError(null);
    const { error } = await signInWithGoogle(redirectTo);
    if (error) {
      setError('Google sign-in failed. Check your OAuth configuration.');
      setGoogleLoading(false);
    }
    // On success, Supabase redirects — no navigation needed
  };

  const handleApple = async () => {
    saveRedirectForPostAuth();
    setAppleLoading(true);
    setError(null);
    const { error } = await signInWithApple(redirectTo);
    if (error) {
      setError('Apple sign-in failed. Check your OAuth configuration.');
      setAppleLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-positive)/0.1)] flex items-center justify-center mx-auto mb-6">
            <Mail size={32} className="text-[rgb(var(--color-positive))]" />
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">Check your email</h1>
          <p className="text-secondary mb-6">
            We sent a sign-in link to <strong>{magicEmail}</strong>.
            Click the link to sign in — it expires in 1 hour.
          </p>
          <button onClick={() => setMagicLinkSent(false)} className="btn-ghost text-muted">
            ← Use a different method
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo size={40} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-primary">Sign in</h1>
          <p className="text-sm text-muted mt-1">to Fall Split</p>
        </div>

        {error && <ErrorMessage message={error} />}

        {/* Email/Password */}
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1">
              Email
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                className="input pl-9"
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
            </div>
            {errors.email && (
              <p id="email-error" className="text-xs text-[rgb(var(--color-negative))] mt-1">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1">
              Password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="input pl-9 pr-9"
                placeholder="••••••••"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="text-xs text-[rgb(var(--color-negative))] mt-1">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-xs text-muted hover:text-secondary">
              Forgot password?
            </Link>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size={18} /> : null}
            Sign in
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t divider" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-3 bg-app text-muted">or</span>
          </div>
        </div>

        {/* Magic Link */}
        <form onSubmit={handleMagicLink} className="space-y-3 mb-4">
          <input
            type="email"
            value={magicEmail}
            onChange={(e) => setMagicEmail(e.target.value)}
            className="input"
            placeholder="Email — get a sign-in link"
            autoComplete="email"
          />
          <button
            type="submit"
            className="btn-secondary w-full"
            disabled={magicLoading || !magicEmail}
          >
            {magicLoading ? <Spinner size={16} /> : <Mail size={16} />}
            Send magic link
          </button>
        </form>

        {/* OAuth */}
        <div className="space-y-3">
          <button onClick={handleGoogle} className="btn-secondary w-full" disabled={googleLoading}>
            {googleLoading ? <Spinner size={16} /> : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

          <button onClick={handleApple} className="btn-secondary w-full" disabled={appleLoading}>
            {appleLoading ? <Spinner size={16} /> : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282z"/>
              </svg>
            )}
            Continue with Apple
          </button>
        </div>

        <p className="text-center text-sm text-muted mt-8">
          No account?{' '}
          <Link to="/register" className="text-primary font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
