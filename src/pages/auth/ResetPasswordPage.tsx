import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Lock } from 'lucide-react';

const schema = z
  .object({
    password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
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
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div>
            <label htmlFor="password" className="text-secondary mb-1 block text-sm font-medium">
              New password
            </label>
            <div className="relative">
              <Lock size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
              <input
                {...register('password')}
                id="password"
                type="password"
                autoComplete="new-password"
                className="input pl-9"
                placeholder="Min 8 chars"
              />
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
                type="password"
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
      </div>
    </div>
  );
}
