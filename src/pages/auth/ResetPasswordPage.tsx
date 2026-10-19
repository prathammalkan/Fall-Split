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

const schema = z.object({
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo size={36} className="mx-auto mb-4" />
          <h1 className="text-xl font-bold text-primary">Set new password</h1>
        </div>
        {error && <ErrorMessage message={error} />}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1">New password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input {...register('password')} id="password" type="password" autoComplete="new-password" className="input pl-9" placeholder="Min 8 chars" />
            </div>
            {errors.password && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.password.message}</p>}
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-secondary mb-1">Confirm password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input {...register('confirmPassword')} id="confirmPassword" type="password" autoComplete="new-password" className="input pl-9" placeholder="Repeat password" />
            </div>
            {errors.confirmPassword && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.confirmPassword.message}</p>}
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
