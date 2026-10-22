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
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="bg-tertiary flex h-16 w-16 items-center justify-center rounded-2xl">
        <Icon size={28} className="text-muted" strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-primary text-base font-semibold">{title}</h3>
        {description && <p className="text-muted mt-1 max-w-xs text-sm">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
