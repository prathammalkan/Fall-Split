import { AlertCircle } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  retry?: () => void;
  retryDisabled?: boolean;
}

export function ErrorMessage({ message, retry, retryDisabled = false }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-[rgb(var(--color-negative)/0.2)] bg-[rgb(var(--color-negative)/0.08)] p-4"
    >
      <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-[rgb(var(--color-negative))]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[rgb(var(--color-negative))]">{message}</p>
        {retry && (
          <button
            onClick={retry}
            disabled={retryDisabled}
            className="mt-1 text-sm font-medium text-[rgb(var(--color-negative))] underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
