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
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
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
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="card max-w-sm w-full text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950 flex items-center justify-center">
                <AlertTriangle size={28} className="text-red-500" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">Something went wrong</h2>
              <p className="text-sm text-muted mt-1">
                An unexpected error occurred. Your data is safe.
              </p>
              {import.meta.env.DEV && this.state.message && (
                <p className="text-xs text-red-500 mt-2 font-mono break-all">
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
