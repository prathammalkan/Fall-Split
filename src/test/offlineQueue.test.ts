import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  getAllOperations,
  queueOfflineOperation,
  syncPendingOperations,
} from '../lib/offlineQueue';

describe('offline itemized expense synchronization', () => {
  it('sends itemized payloads atomically and fails legacy incomplete items visibly', async () => {
    const userId = 'user-1';
    const idempotencyKey = 'itemized-operation-1';
    const expensePayload = {
      title: 'Shared meal',
      amount_paise: 100,
      currency: 'INR',
      split_method: 'itemized',
      group_id: null,
      creator_id: userId,
      expense_date: '2026-01-01',
      category: null,
      notes: null,
      payers: [{ userId, amountPaise: 100 }],
      shares: [{ userId, amountPaise: 100 }],
    };
    const item = {
      name: 'Meal',
      quantity: 1,
      unit_price_paise: 100,
      total_paise: 100,
      sort_order: 0,
      allocations: [{ userId, amountPaise: 100 }],
    };

    await queueOfflineOperation({
      type: 'create_expense',
      idempotencyKey,
      payload: { ...expensePayload, idempotency_key: idempotencyKey, items: [item] },
    });
    await queueOfflineOperation({
      type: 'create_expense',
      idempotencyKey: 'legacy-itemized-operation',
      payload: { ...expensePayload, idempotency_key: 'legacy-itemized-operation' },
    });

    const rpc = vi.fn().mockResolvedValue({ data: 'expense-1', error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      rpc,
    } as unknown as SupabaseClient;

    const summary = await syncPendingOperations(client);
    const operations = await getAllOperations();

    expect(summary).toMatchObject({ synced: 1, failed: 1, conflicts: 0 });
    expect(summary.errors[0]?.message).toContain('missing line items');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_itemized_expense_with_records', {
      p_expense: expect.objectContaining({ idempotency_key: idempotencyKey }),
      p_payers: expensePayload.payers,
      p_shares: expensePayload.shares,
      p_items: [item],
    });
    expect(operations.find((operation) => operation.idempotencyKey === idempotencyKey)?.state).toBe(
      'synced'
    );
    expect(
      operations.find((operation) => operation.idempotencyKey === 'legacy-itemized-operation')
        ?.state
    ).toBe('failed');
  });
});
