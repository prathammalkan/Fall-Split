import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-muted mb-4 text-5xl font-black">404</h1>
        <p className="text-primary mb-2 text-lg font-semibold">Page not found</p>
        <p className="text-secondary mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
