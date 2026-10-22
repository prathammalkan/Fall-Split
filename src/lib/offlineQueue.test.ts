import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOperationsForUser,
  getAllOperations,
  getPendingOperations,
  queueOfflineOperation,
  syncPendingOperations,
  updateOperationState,
} from './offlineQueue';

const payload = {
  title: 'Dinner',
  amount_paise: 5000,
  currency: 'INR',
  split_method: 'equal',
  group_id: null,
  creator_id: 'user-1',
  expense_date: '2026-10-21',
  category: 'Food',
  notes: null,
  idempotency_key: 'dinner-expense-key-1',
  payers: [{ userId: 'user-1', amountPaise: 5000 }],
  shares: [{ userId: 'user-1', amountPaise: 5000 }],
};

type ExpenseInput = Omit<typeof payload, 'payers' | 'shares'>;

type RpcArgs = {
  p_expense: ExpenseInput;
  p_payers: typeof payload.payers;
  p_shares: typeof payload.shares;
};

interface PersistedExpense {
  id: string;
  expense: RpcArgs['p_expense'];
  payers: RpcArgs['p_payers'];
  shares: RpcArgs['p_shares'];
}

function createClient(
  options: {
    userId?: string;
    failAt?: 'header' | 'payers' | 'shares';
    loseFirstResponse?: boolean;
    records?: Map<string, PersistedExpense>;
  } = {}
) {
  const records = options.records ?? new Map<string, PersistedExpense>();
  let requestCount = 0;
  const rpc = vi.fn(async (_name: string, args: RpcArgs) => {
    requestCount++;
    const idempotencyKey = args.p_expense.idempotency_key;
    if (options.failAt === 'header')
      return { data: null, error: { message: 'expense header write failed' } };
    if (options.failAt === 'payers')
      return { data: null, error: { message: 'payer contribution write failed' } };
    if (options.failAt === 'shares')
      return { data: null, error: { message: 'participant share write failed' } };

    let saved = records.get(idempotencyKey);
    if (saved && JSON.stringify(saved.expense) !== JSON.stringify(args.p_expense)) {
      return { data: null, error: { message: 'idempotency key payload mismatch' } };
    }
    if (!saved) {
      saved = {
        id: 'expense-123',
        expense: args.p_expense,
        payers: [],
        shares: [],
      };
      records.set(idempotencyKey, saved);
    }

    const payerTotal = args.p_payers.reduce((sum, payer) => sum + payer.amountPaise, 0);
    const shareTotal = args.p_shares.reduce((sum, share) => sum + share.amountPaise, 0);
    if (payerTotal !== args.p_expense.amount_paise || shareTotal !== args.p_expense.amount_paise) {
      return { data: null, error: { message: 'financial totals do not reconcile' } };
    }

    saved.payers = args.p_payers;
    saved.shares = args.p_shares;
    if (options.loseFirstResponse && requestCount === 1) {
      return { data: null, error: { message: 'response lost after transaction committed' } };
    }
    return { data: saved.id, error: null };
  });
  const from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: 'user-1' }, error: null }),
  }));
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } },
        error: null,
      }),
    },
    from,
    rpc,
  } as unknown as Parameters<typeof syncPendingOperations>[0];
  return { client, records, rpc };
}

async function queuePayload(key = 'dinner-sync-key-1', item = payload) {
  return queueOfflineOperation({
    type: 'create_expense',
    payload: { ...item, idempotency_key: key },
    idempotencyKey: key,
  });
}

describe('offlineQueue', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  it('deduplicates identical queued operations by idempotency key', async () => {
    const first = await queuePayload('groceries-dedupe-key-1', {
      ...payload,
      title: 'Groceries',
      idempotency_key: 'groceries-dedupe-key-1',
    });
    const second = await queuePayload('groceries-dedupe-key-1', {
      ...payload,
      title: 'Groceries',
      idempotency_key: 'groceries-dedupe-key-1',
    });

    expect(second.id).toBe(first.id);
    expect(await getAllOperations()).toHaveLength(1);
  });

  it('deduplicates concurrent submissions by idempotency key', async () => {
    const concurrentPayload = {
      ...payload,
      title: 'Concurrent dinner',
      idempotency_key: 'concurrent-dinner-key',
    };
    const [first, second] = await Promise.all([
      queuePayload('concurrent-dinner-key', concurrentPayload),
      queuePayload('concurrent-dinner-key', concurrentPayload),
    ]);

    expect(second.id).toBe(first.id);
    expect(await getAllOperations()).toHaveLength(1);
  });

  it('rejects reusing a queued key for a different payload', async () => {
    await queuePayload('reused-idempotency-key-1');
    await expect(
      queuePayload('reused-idempotency-key-1', { ...payload, title: 'Different expense' })
    ).rejects.toThrow('already queued for a different operation');
  });

  it('requires a non-empty idempotency key', async () => {
    await expect(
      queueOfflineOperation({
        type: 'create_expense',
        payload: { title: 'Nope' },
        idempotencyKey: '   ',
      })
    ).rejects.toThrow('idempotencyKey is required');
  });

  it.each([
    ['expense header', 'header'],
    ['payer contribution', 'payers'],
    ['participant share', 'shares'],
  ] as const)('keeps a failed %s write visible and retryable', async (_record, failAt) => {
    await queuePayload(`failure-${failAt}-idempotency-key`);
    const { client, records } = createClient({ failAt });

    const result = await syncPendingOperations(client);
    const [operation] = await getAllOperations();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(operation?.state).toBe('failed');
    expect(operation?.lastError).toContain('write failed');
    expect(operation?.retryCount).toBe(1);
    expect(records.size).toBe(0);
  });

  it('repairs a partial authoritative expense and verifies payer/share conservation before syncing', async () => {
    const key = 'partial-expense-idempotency-key';
    await queuePayload(key);
    const records = new Map<string, PersistedExpense>([
      [
        key,
        {
          id: 'existing-expense',
          expense: {
            title: payload.title,
            amount_paise: payload.amount_paise,
            currency: payload.currency,
            split_method: payload.split_method,
            group_id: payload.group_id,
            creator_id: payload.creator_id,
            expense_date: payload.expense_date,
            category: payload.category,
            notes: payload.notes,
            idempotency_key: key,
          },
          payers: [],
          shares: [],
        },
      ],
    ]);
    const { client } = createClient({ records });

    const result = await syncPendingOperations(client);
    const saved = records.get(key);

    expect(result).toMatchObject({ synced: 1, failed: 0, conflicts: 0 });
    expect(saved?.id).toBe('existing-expense');
    expect(saved?.payers).toEqual(payload.payers);
    expect(saved?.shares).toEqual(payload.shares);
    expect(saved?.payers.reduce((sum, payer) => sum + payer.amountPaise, 0)).toBe(
      payload.amount_paise
    );
    expect(saved?.shares.reduce((sum, share) => sum + share.amountPaise, 0)).toBe(
      payload.amount_paise
    );
    expect((await getAllOperations())[0]?.state).toBe('synced');
  });

  it('preserves exact totals across multiple payers and participants', async () => {
    const key = 'multi-party-conservation-key';
    const multiPartyPayload = {
      ...payload,
      amount_paise: 1000,
      idempotency_key: key,
      payers: [
        { userId: 'user-1', amountPaise: 400 },
        { userId: 'user-2', amountPaise: 600 },
      ],
      shares: [
        { userId: 'user-1', amountPaise: 333 },
        { userId: 'user-2', amountPaise: 667 },
      ],
    };
    await queuePayload(key, multiPartyPayload);
    const { client, records } = createClient();

    const result = await syncPendingOperations(client);
    const saved = records.get(key);

    expect(result.synced).toBe(1);
    expect(saved?.payers.reduce((sum, payer) => sum + payer.amountPaise, 0)).toBe(1000);
    expect(saved?.shares.reduce((sum, share) => sum + share.amountPaise, 0)).toBe(1000);
  });

  it('retries a committed operation after a lost response without creating a second expense', async () => {
    const key = 'lost-response-idempotency-key';
    await queuePayload(key);
    const { client, records, rpc } = createClient({ loseFirstResponse: true });

    const first = await syncPendingOperations(client);
    expect(first.failed).toBe(1);
    expect((await getAllOperations())[0]?.state).toBe('failed');

    const second = await syncPendingOperations(client);
    expect(second.synced).toBe(1);
    expect(records.size).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect((await getAllOperations())[0]?.serverId).toBe('expense-123');
  });

  it('recovers interrupted syncing operations after a restart', async () => {
    const operation = await queuePayload('restart-recovery-idempotency-key');
    await updateOperationState(operation.id, 'syncing');

    const pending = await getPendingOperations('user-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.state).toBe('pending');
    expect(pending[0]?.lastError).toContain('interrupted');
  });

  it('reuses one logical expense for repeated submissions with the same server key', async () => {
    const key = 'duplicate-submission-idempotency-key';
    await queuePayload(key);
    const { client, records, rpc } = createClient();

    const first = await syncPendingOperations(client);
    await queuePayload(key);
    const second = await syncPendingOperations(client);

    expect(first.synced).toBe(1);
    expect(second.synced).toBe(0);
    expect(records.size).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not sync operations belonging to another authenticated account', async () => {
    await queuePayload('account-isolation-idempotency-key');
    const { client } = createClient({ userId: 'user-2' });

    const result = await syncPendingOperations(client);
    const [operation] = await getAllOperations();

    expect(result.synced).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(operation?.state).toBe('pending');
  });

  it('clears only the deleted account’s local offline operations', async () => {
    await queuePayload('user-one-offline-key');
    await queuePayload('user-two-offline-key', { ...payload, creator_id: 'user-2' });

    await clearOperationsForUser('user-1');

    const operations = await getAllOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]?.payload).toMatchObject({ creator_id: 'user-2' });
  });
});
