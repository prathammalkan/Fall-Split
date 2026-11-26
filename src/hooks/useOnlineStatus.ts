import { useState, useEffect, useCallback, useRef } from 'react';
import { getOutboxSummaryForUser, syncPendingOperations } from '../lib/offlineQueue';
import { supabase } from '../lib/supabase';

export function useOnlineStatus(): {
  isOnline: boolean;
  syncError: string | null;
  pendingCount: number;
  retrySync: () => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const runSync = useCallback(
    async (respectBackoff: boolean) => {
      clearRetryTimer();
      try {
        const result = await syncPendingOperations(supabase, { respectBackoff });
        if (!mountedRef.current) return;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mountedRef.current) return;

        const outbox = user
          ? await getOutboxSummaryForUser(user.id)
          : { pending: 0, failed: 0, conflicts: 0, nextRetryDelayMs: null };
        if (!mountedRef.current) return;

        setPendingCount(outbox.pending + outbox.failed);

        if (result.failed || result.conflicts) {
          const firstError = result.errors[0]?.message;
          setSyncError(
            `Expense sync needs attention (${result.failed} failed, ${result.conflicts} conflicts).${firstError ? ` ${firstError}` : ''}`
          );
          if (
            result.failed > 0 &&
            navigator.onLine &&
            outbox.nextRetryDelayMs !== null &&
            import.meta.env.MODE !== 'test'
          ) {
            retryTimerRef.current = setTimeout(
              () => {
                if (mountedRef.current && navigator.onLine) {
                  void runSync(true);
                }
              },
              Math.max(1000, outbox.nextRetryDelayMs)
            );
          }
        } else if (outbox.failed === 0 && outbox.conflicts === 0) {
          setSyncError(null);
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setSyncError(
          error instanceof Error ? error.message : 'Expense synchronization could not be completed.'
        );
      }
    },
    [clearRetryTimer]
  );

  const retrySync = useCallback(async () => {
    await runSync(false);
  }, [runSync]);

  useEffect(() => {
    mountedRef.current = true;
    const handleOnline = () => {
      setIsOnline(true);
      void runSync(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      clearRetryTimer();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine) void runSync(false);
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runSync, clearRetryTimer]);

  return { isOnline, syncError, pendingCount, retrySync };
}
