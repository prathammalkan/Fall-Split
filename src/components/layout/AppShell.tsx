import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function AppShell({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus();

  return (
    <div className="app-shell">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[rgb(var(--color-pending))] text-white text-center text-xs py-1 font-medium">
          Offline — expenses will sync when you reconnect
        </div>
      )}
      <main className="flex-1">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
