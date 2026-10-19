import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-5xl font-black text-muted mb-4">404</h1>
        <p className="text-lg font-semibold text-primary mb-2">Page not found</p>
        <p className="text-secondary mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="btn-primary">Go home</Link>
      </div>
    </div>
  );
}
