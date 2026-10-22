import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function AppShell({ children }: { children: ReactNode }) {
  const { isOnline, syncError, retrySync } = useOnlineStatus();

  return (
    <div className="app-shell">
      {!isOnline && (
        <div className="fixed top-0 right-0 left-0 z-50 bg-[rgb(var(--color-pending))] py-1 text-center text-xs font-medium text-white">
          Offline — expenses will sync when you reconnect
        </div>
      )}
      {isOnline && syncError && (
        <div
          role="alert"
          className="fixed top-0 right-0 left-0 z-50 bg-[rgb(var(--color-negative))] py-2 text-center text-xs font-medium text-white"
        >
          {syncError}{' '}
          <button type="button" className="underline" onClick={() => void retrySync()}>
            Retry now
          </button>
        </div>
      )}
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
