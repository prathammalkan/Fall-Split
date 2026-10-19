import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { Logo } from '../../components/brand/Logo';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { Mail, CheckCircle } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
});

type FormData = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    // Always show success — don't reveal if email exists
    await resetPassword(data.email);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <CheckCircle size={48} className="text-[rgb(var(--color-positive))] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-primary mb-2">Check your email</h1>
          <p className="text-secondary text-sm mb-6">
            If an account exists for <strong>{getValues('email')}</strong>, you'll receive a password reset link.
          </p>
          <Link to="/login" className="btn-primary block w-full text-center">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo size={36} className="mx-auto mb-4" />
          <h1 className="text-xl font-bold text-primary">Forgot password</h1>
          <p className="text-sm text-muted mt-1">We'll send a reset link</p>
        </div>

        {error && <ErrorMessage message={error} />}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                {...register('email')}
                id="email" type="email" autoComplete="email"
                className="input pl-9" placeholder="you@example.com"
              />
            </div>
            {errors.email && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.email.message}</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size={18} /> : null}
            Send reset link
          </button>
        </form>

        <Link to="/login" className="block text-center text-sm text-muted mt-6 hover:underline">← Back to sign in</Link>
      </div>
    </div>
  );
}
