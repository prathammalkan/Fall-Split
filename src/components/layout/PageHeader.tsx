import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean | string | (() => void); // true = go back, string = specific path, fn = custom handler
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
    <header className="bg-app border-app sticky top-0 z-30 border-b">
      <div className="flex items-center gap-3 px-4 py-3">
        {back && (
          <button
            onClick={handleBack}
            className="btn-ghost -ml-2 rounded-full p-2"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-primary truncate text-base font-semibold">{title}</h1>
          {subtitle && <p className="text-muted truncate text-xs">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
