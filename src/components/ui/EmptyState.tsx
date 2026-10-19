import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-tertiary flex items-center justify-center">
        <Icon size={28} className="text-muted" strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-primary">{title}</h3>
        {description && (
          <p className="text-sm text-muted mt-1 max-w-xs">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
