import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  displayName: z.string().min(1, 'Name is required').max(60, 'Name too long'),
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    const { error } = await signUp(data.email, data.password, data.displayName);
    if (error) {
      // Generic to avoid enumeration
      setError('Could not create account. Try a different email.');
      return;
    }
    setRegisteredEmail(data.email);
    setRegistered(true);
  };

  if (registered) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-positive)/0.1)] flex items-center justify-center mx-auto mb-6">
            <Mail size={32} className="text-[rgb(var(--color-positive))]" />
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">Verify your email</h1>
          <p className="text-secondary mb-2">
            We sent a verification link to <strong>{registeredEmail}</strong>.
          </p>
          <p className="text-sm text-muted mb-6">
            Click the link in the email to activate your account.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="btn-primary w-full"
          >
            Back to sign in
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
          <h1 className="text-2xl font-bold text-primary">Create account</h1>
          <p className="text-sm text-muted mt-1">Start splitting expenses</p>
        </div>

        {error && <ErrorMessage message={error} />}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-secondary mb-1">Name</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
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
            {errors.displayName && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.displayName.message}</p>}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1">Email</label>
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
              />
            </div>
            {errors.email && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className="input pl-9 pr-9"
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                aria-invalid={!!errors.password}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label="Toggle password">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.password.message}</p>}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-secondary mb-1">Confirm password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
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
            {errors.confirmPassword && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.confirmPassword.message}</p>}
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size={18} /> : null}
            Create account
          </button>
        </form>

        <p className="text-center text-sm text-muted mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
