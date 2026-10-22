import { useState, useEffect, useCallback } from 'react';
import { syncPendingOperations } from '../lib/offlineQueue';
import { supabase } from '../lib/supabase';

export function useOnlineStatus(): {
  isOnline: boolean;
  syncError: string | null;
  retrySync: () => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncError, setSyncError] = useState<string | null>(null);

  const retrySync = useCallback(async () => {
    try {
      const result = await syncPendingOperations(supabase);
      if (result.failed || result.conflicts) {
        const firstError = result.errors[0]?.message;
        setSyncError(
          `Expense sync needs attention (${result.failed} failed, ${result.conflicts} conflicts).${firstError ? ` ${firstError}` : ''}`
        );
      } else {
        setSyncError(null);
      }
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : 'Expense synchronization could not be completed.'
      );
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void retrySync();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine) void retrySync();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [retrySync]);

  return { isOnline, syncError, retrySync };
}
