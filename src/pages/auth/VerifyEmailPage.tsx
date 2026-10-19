import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Logo } from '../../components/brand/Logo';

export function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Logo size={40} className="mx-auto mb-6" />
        <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-accent)/0.1)] flex items-center justify-center mx-auto mb-6">
          <Mail size={32} className="text-[rgb(var(--color-accent))]" />
        </div>
        <h1 className="text-2xl font-bold text-primary mb-2">Verify your email</h1>
        <p className="text-secondary mb-6">
          Please verify your email address before using Fall Split. Check your inbox for a verification link.
        </p>
        <Link to="/login" className="btn-secondary block w-full text-center">Back to sign in</Link>
      </div>
    </div>
  );
}
