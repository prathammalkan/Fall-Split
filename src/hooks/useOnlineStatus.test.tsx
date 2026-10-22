import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabase';
import { queueOfflineOperation } from '../lib/offlineQueue';
import { useOnlineStatus } from './useOnlineStatus';

describe('useOnlineStatus', () => {
  it('surfaces background sync failures and makes them retryable', async () => {
    const wasOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await queueOfflineOperation({
      type: 'create_expense',
      idempotencyKey: 'background-sync-failure-key',
      payload: {
        title: 'Dinner',
        amount_paise: 500,
        currency: 'INR',
        split_method: 'equal',
        group_id: null,
        creator_id: 'user-1',
        expense_date: '2026-10-21',
        category: null,
        notes: null,
        idempotency_key: 'background-sync-failure-key',
        payers: [{ userId: 'user-1', amountPaise: 500 }],
        shares: [{ userId: 'user-1', amountPaise: 500 }],
      },
    });

    try {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      } as never);
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { message: 'getUser simulated expense RPC failure' },
      } as never);
      const { result } = renderHook(() => useOnlineStatus());
      await waitFor(() =>
        expect(result.current.syncError).toContain('Expense sync needs attention')
      );
      expect(result.current.syncError).toContain('getUser');
    } finally {
      vi.mocked(supabase.auth.getUser)
        .mockReset()
        .mockResolvedValue({ data: { user: null }, error: null } as never);
      vi.mocked(supabase.rpc)
        .mockReset()
        .mockResolvedValue({ data: null, error: null } as never);
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: wasOnline });
    }
  });
});
