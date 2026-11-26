import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function AppShell({ children }: { children: ReactNode }) {
  const { isOnline, syncError, pendingCount, retrySync } = useOnlineStatus();

  return (
    <div className="app-shell">
      {!isOnline && (
        <div
          role="status"
          className="sticky top-0 z-40 bg-[rgb(var(--color-pending))] px-3 py-1.5 text-center text-xs font-medium text-white"
        >
          Offline — expenses saved on this device will sync when you reconnect
          {pendingCount > 0 ? ` (${pendingCount} queued)` : ''}
        </div>
      )}
      {isOnline && syncError && (
        <div
          role="alert"
          className="sticky top-0 z-40 bg-[rgb(var(--color-negative))] px-3 py-2 text-center text-xs font-medium text-white"
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
