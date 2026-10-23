import { openDB, type IDBPDatabase } from 'idb';
import type { OutboxOperation, OutboxOperationType, OutboxState } from '../types';

const DB_NAME = 'fall-split-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'operations';
const SCHEMA_VERSION = 1;

interface DBSchema {
  [STORE_NAME]: {
    key: string;
    value: OutboxOperation;
    indexes: { 'by-state': OutboxState; 'by-created': number };
  };
}

async function getDB(): Promise<IDBPDatabase<DBSchema>> {
  return openDB<DBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('by-state', 'state');
      store.createIndex('by-created', 'createdAt');
    },
  });
}

export interface QueueInput {
  type: OutboxOperationType;
  payload: unknown;
  idempotencyKey: string;
}

export interface SyncFailure {
  id: string;
  idempotencyKey: string;
  message: string;
  conflict: boolean;
}

export interface SyncSummary {
  synced: number;
  failed: number;
  conflicts: number;
  errors: SyncFailure[];
}

function getPayloadOwnerId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('creator_id' in payload) || typeof payload.creator_id !== 'string') return null;
  return payload.creator_id;
}

function getOperationOwnerId(operation: OutboxOperation): string | null {
  return getPayloadOwnerId(operation.payload);
}

export async function clearOperationsForUser(userId: string): Promise<void> {
  if (!userId) throw new Error('userId is required to clear offline operations');
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const operations = await store.getAll();
  const deletions = operations
    .filter((operation) => getOperationOwnerId(operation) === userId)
    .map((operation) => store.delete(operation.id));
  await Promise.all(deletions);
  await tx.done;
}

export async function removeOperationsForExpense(
  expenseId: string,
  userId?: string
): Promise<void> {
  if (!expenseId) return;
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const operations = await store.getAll();
  const deletions = operations
    .filter((op) => {
      if (userId && getOperationOwnerId(op) !== userId) return false;
      if (op.serverId === expenseId) return true;
      if (
        typeof op.payload === 'object' &&
        op.payload !== null &&
        'id' in op.payload &&
        (op.payload as { id: unknown }).id === expenseId
      ) {
        return true;
      }
      return false;
    })
    .map((op) => store.delete(op.id));
  await Promise.all(deletions);
  await tx.done;
}

export async function getOperationByIdempotencyKey(
  idempotencyKey: string,
  userId: string
): Promise<OutboxOperation | null> {
  const db = await getDB();
  const operations = await db.getAll(STORE_NAME);
  return (
    operations.find(
      (op) => op.idempotencyKey === idempotencyKey && getOperationOwnerId(op) === userId
    ) ?? null
  );
}

export async function queueOfflineOperation(input: QueueInput): Promise<OutboxOperation> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required');
  }
  if (
    input.type === 'create_expense' &&
    (typeof input.payload !== 'object' ||
      input.payload === null ||
      !('idempotency_key' in input.payload) ||
      input.payload.idempotency_key !== idempotencyKey)
  ) {
    throw new Error('Expense payload idempotency_key must match the queued operation key');
  }
  const ownerId = getPayloadOwnerId(input.payload);
  if (!ownerId) throw new Error('Offline operation payload must identify its creator');

  const db = await getDB();
  const op: OutboxOperation = {
    id: crypto.randomUUID(),
    idempotencyKey,
    type: input.type,
    schemaVersion: SCHEMA_VERSION,
    payload: input.payload,
    state: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    retryCount: 0,
  };

  // Keep lookup and insert in one readwrite transaction. IndexedDB serializes
  // readwrite transactions for this store across tabs, preventing concurrent
  // submissions from creating duplicate local operations.
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const existing = (await store.getAll()).find(
    (operation) =>
      operation.idempotencyKey === idempotencyKey && getOperationOwnerId(operation) === ownerId
  );
  if (existing) {
    await tx.done;
    if (
      existing.type !== input.type ||
      JSON.stringify(existing.payload) !== JSON.stringify(input.payload)
    ) {
      throw new Error('idempotencyKey is already queued for a different operation');
    }
    return existing;
  }

  await store.add(op);
  await tx.done;
  return op;
}

export async function getPendingOperations(userId: string): Promise<OutboxOperation[]> {
  if (!userId) throw new Error('userId is required to read offline operations');
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const operations = await store.getAll();
  const recoverable: OutboxOperation[] = [];

  for (const operation of operations) {
    if (getOperationOwnerId(operation) !== userId) continue;
    if (operation.state === 'syncing') {
      operation.state = 'pending';
      operation.lastError = 'Recovered an interrupted synchronization; safe retry requested.';
      operation.updatedAt = Date.now();
      await store.put(operation);
    }
    if (operation.state === 'pending' || operation.state === 'failed') {
      recoverable.push(operation);
    }
  }

  await tx.done;
  return recoverable.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateOperationState(
  id: string,
  state: OutboxState,
  updates?: Partial<Pick<OutboxOperation, 'serverId' | 'lastError' | 'retryCount' | 'conflictInfo'>>
): Promise<void> {
  const db = await getDB();
  const op = await db.get(STORE_NAME, id);
  if (!op) return;

  const next: OutboxOperation = {
    ...op,
    ...updates,
    state,
    updatedAt: Date.now(),
  };

  if (state === 'synced') {
    next.lastError = undefined;
    next.conflictInfo = undefined;
  } else if (state === 'syncing') {
    next.lastError = undefined;
  }

  await db.put(STORE_NAME, next);
}

export async function markOperationSynced(id: string, serverId: string): Promise<void> {
  await updateOperationState(id, 'synced', { serverId });
}

export async function getAllOperations(): Promise<OutboxOperation[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

interface CreateExpensePayload {
  title: string;
  amount_paise: number;
  currency: string;
  split_method: string;
  group_id: string | null;
  creator_id: string;
  expense_date: string;
  category: string | null;
  notes: string | null;
  idempotency_key: string;
  payers: { userId: string; amountPaise: number }[];
  shares: {
    userId: string;
    amountPaise: number;
    percentage?: number | null;
    shareWeight?: number | null;
  }[];
  items?: {
    name: string;
    quantity: number;
    unit_price_paise: number;
    total_paise: number;
    sort_order: number;
    allocations: { userId: string; amountPaise: number }[];
  }[];
}

interface OperationResult {
  success: boolean;
  serverId?: string;
  conflict?: boolean;
  conflictInfo?: unknown;
  error?: string;
}

async function syncOperation(
  op: OutboxOperation,
  supabaseClient: import('@supabase/supabase-js').SupabaseClient
): Promise<OperationResult> {
  if (op.type !== 'create_expense') {
    return { success: false, error: `Unknown operation type: ${op.type}` };
  }

  const payload = op.payload as CreateExpensePayload;
  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return {
      success: false,
      error: authError?.message ?? 'Authentication required to sync queued expense',
    };
  }

  if (payload.creator_id !== user.id) {
    return {
      success: false,
      conflict: true,
      conflictInfo: {
        reason: 'Queued operation belongs to a different authenticated user',
        queuedUserId: payload.creator_id,
        currentUserId: user.id,
      },
    };
  }

  if (payload.group_id) {
    const { data: member, error: membershipError } = await supabaseClient
      .from('group_members')
      .select('user_id')
      .eq('group_id', payload.group_id)
      .eq('user_id', payload.creator_id)
      .is('removed_at', null)
      .maybeSingle();
    if (membershipError) {
      return { success: false, error: membershipError.message };
    }
    if (!member) {
      return {
        success: false,
        conflict: true,
        conflictInfo: { reason: 'No longer a member of this group' },
      };
    }
  }

  const expensePayload = {
    p_expense: {
      title: payload.title,
      amount_paise: payload.amount_paise,
      currency: payload.currency,
      split_method: payload.split_method,
      group_id: payload.group_id,
      creator_id: payload.creator_id,
      expense_date: payload.expense_date,
      category: payload.category,
      notes: payload.notes,
      idempotency_key: op.idempotencyKey,
    },
    p_payers: payload.payers,
    p_shares: payload.shares,
  };
  let response;
  if (payload.split_method === 'itemized') {
    const itemizedItems = payload.items;
    if (!Array.isArray(itemizedItems) || itemizedItems.length === 0) {
      return {
        success: false,
        error: 'Queued itemized expense is missing line items and cannot be synchronized safely',
      };
    }
    response = await supabaseClient.rpc('create_itemized_expense_with_records', {
      ...expensePayload,
      p_items: itemizedItems,
    });
  } else {
    response = await supabaseClient.rpc('create_expense_with_records', expensePayload);
  }

  const { data: expenseId, error } = response;
  if (error) return { success: false, error: error.message };
  if (typeof expenseId !== 'string' || !expenseId) {
    return { success: false, error: 'Expense synchronization returned no verified server ID' };
  }

  return { success: true, serverId: expenseId };
}

export async function syncPendingOperations(
  supabaseClient: import('@supabase/supabase-js').SupabaseClient
): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, failed: 0, conflicts: 0, errors: [] };
  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();
  if (authError || !user) return summary;
  const pending = await getPendingOperations(user.id);

  for (const op of pending) {
    await updateOperationState(op.id, 'syncing');
    try {
      const result = await syncOperation(op, supabaseClient);
      if (result.success && result.serverId) {
        await markOperationSynced(op.id, result.serverId);
        summary.synced++;
      } else if (result.conflict) {
        const message =
          typeof result.conflictInfo === 'object' &&
          result.conflictInfo !== null &&
          'reason' in result.conflictInfo
            ? String(result.conflictInfo.reason)
            : 'Queued operation conflicts with current account or server state';
        await updateOperationState(op.id, 'conflict', {
          conflictInfo: result.conflictInfo,
          lastError: message,
        });
        summary.conflicts++;
        summary.errors.push({
          id: op.id,
          idempotencyKey: op.idempotencyKey,
          message,
          conflict: true,
        });
      } else {
        const message = result.error ?? 'Expense synchronization failed without an error message';
        await updateOperationState(op.id, 'failed', {
          lastError: message,
          retryCount: op.retryCount + 1,
        });
        summary.failed++;
        summary.errors.push({
          id: op.id,
          idempotencyKey: op.idempotencyKey,
          message,
          conflict: false,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown synchronization error';
      await updateOperationState(op.id, 'failed', {
        lastError: message,
        retryCount: op.retryCount + 1,
      });
      summary.failed++;
      summary.errors.push({
        id: op.id,
        idempotencyKey: op.idempotencyKey,
        message,
        conflict: false,
      });
    }
  }

  return summary;
}
