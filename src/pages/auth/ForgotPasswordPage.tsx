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

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
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
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-[rgb(var(--color-positive))]" />
          <h1 className="text-primary mb-2 text-xl font-bold">Check your email</h1>
          <p className="text-secondary mb-6 text-sm">
            If an account exists for <strong>{getValues('email')}</strong>, you'll receive a
            password reset link.
          </p>
          <Link to="/login" className="btn-primary block w-full text-center">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={36} className="mx-auto mb-4" />
          <h1 className="text-primary text-xl font-bold">Forgot password</h1>
          <p className="text-muted mt-1 text-sm">We'll send a reset link</p>
        </div>

        {error && <ErrorMessage message={error} />}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                {errors.email.message}
              </p>
            )}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner size={18} /> : null}
            Send reset link
          </button>
        </form>

        <Link to="/login" className="text-muted mt-6 block text-center text-sm hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
