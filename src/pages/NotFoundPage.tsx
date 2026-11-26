import { Link } from 'react-router-dom';
import { Logo } from '../components/brand/Logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-xs text-center">
        <Logo size={40} className="mx-auto mb-4" />
        <h1 className="text-muted mb-2 text-5xl font-black">404</h1>
        <p className="text-primary mb-2 text-lg font-semibold">Page not found</p>
        <p className="text-secondary mb-6 text-sm">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link to="/" className="btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
