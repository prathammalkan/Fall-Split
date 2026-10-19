import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean | string | (() => void);  // true = go back, string = specific path, fn = custom handler
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (typeof back === 'function') {
      back();
    } else if (typeof back === 'string') {
      navigate(back);
    } else {
      navigate(-1);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-app border-b border-app">
      <div className="flex items-center gap-3 px-4 py-3">
        {back && (
          <button
            onClick={handleBack}
            className="btn-ghost p-2 -ml-2 rounded-full"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-primary truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted truncate">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
