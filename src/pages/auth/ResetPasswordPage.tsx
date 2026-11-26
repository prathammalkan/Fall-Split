import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Lock, Eye, EyeOff } from 'lucide-react';

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { updatePassword, session } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    if (!session) {
      setError('Your password reset session has expired. Please request a new reset link.');
      return;
    }
    const { error } = await updatePassword(data.password);
    if (error) {
      setError('Could not update password. The link may have expired.');
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={36} className="mx-auto mb-4" />
          <h1 className="text-primary text-xl font-bold">Set new password</h1>
        </div>
        {error && <ErrorMessage message={error} />}
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
          <div>
            <label htmlFor="password" className="text-secondary mb-1 block text-sm font-medium">
              New password
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
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted absolute top-1/2 right-3 -translate-y-1/2"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
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
            Update password
          </button>
        </form>
        <Link
          to="/forgot-password"
          className="text-muted mt-6 block text-center text-sm hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    </div>
  );
}
