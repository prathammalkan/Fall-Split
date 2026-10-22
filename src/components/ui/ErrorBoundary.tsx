import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional fallback override */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Top-level React Error Boundary.
 *
 * Catches any uncaught exception in the React component tree and renders a
 * friendly recovery card instead of crashing the entire app with a blank
 * white screen.  The user can tap "Reload" to restore the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    return { hasError: true, message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production you would forward this to a monitoring service.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="card w-full max-w-sm space-y-4 text-center">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950">
                <AlertTriangle size={28} className="text-red-500" />
              </div>
            </div>
            <div>
              <h2 className="text-primary text-lg font-semibold">Something went wrong</h2>
              <p className="text-muted mt-1 text-sm">
                An unexpected error occurred. Your data is safe.
              </p>
              {import.meta.env.DEV && this.state.message && (
                <p className="mt-2 font-mono text-xs break-all text-red-500">
                  {this.state.message}
                </p>
              )}
            </div>
            <button onClick={this.handleReload} className="btn-primary w-full">
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
