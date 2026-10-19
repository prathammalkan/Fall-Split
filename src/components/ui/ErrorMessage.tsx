import { AlertCircle } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  retry?: () => void;
}

export function ErrorMessage({ message, retry }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg p-4 bg-[rgb(var(--color-negative)/0.08)] border border-[rgb(var(--color-negative)/0.2)]"
    >
      <AlertCircle size={18} className="text-[rgb(var(--color-negative))] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[rgb(var(--color-negative))]">{message}</p>
        {retry && (
          <button onClick={retry} className="text-sm font-medium text-[rgb(var(--color-negative))] underline mt-1">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
