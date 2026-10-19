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

export async function queueOfflineOperation(input: QueueInput): Promise<OutboxOperation> {
  const db = await getDB();
  const op: OutboxOperation = {
    id: crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey,
    type: input.type,
    schemaVersion: SCHEMA_VERSION,
    payload: input.payload,
    state: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    retryCount: 0,
  };
  await db.add(STORE_NAME, op);
  return op;
}

export async function getPendingOperations(): Promise<OutboxOperation[]> {
  const db = await getDB();
  return db.getAllFromIndex(STORE_NAME, 'by-state', 'pending');
}

export async function updateOperationState(
  id: string,
  state: OutboxState,
  updates?: Partial<Pick<OutboxOperation, 'serverId' | 'lastError' | 'retryCount' | 'conflictInfo'>>
): Promise<void> {
  const db = await getDB();
  const op = await db.get(STORE_NAME, id);
  if (!op) return;
  await db.put(STORE_NAME, { ...op, ...updates, state, updatedAt: Date.now() });
}

export async function markOperationSynced(id: string, serverId: string): Promise<void> {
  await updateOperationState(id, 'synced', { serverId });
}

export async function getAllOperations(): Promise<OutboxOperation[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

interface SyncResult {
  success: boolean;
  serverId?: string;
  conflict?: boolean;
  conflictInfo?: unknown;
  error?: string;
}

async function syncOperation(
  op: OutboxOperation,
  supabaseClient: import('@supabase/supabase-js').SupabaseClient
): Promise<SyncResult> {
  if (op.type === 'create_expense') {
    const payload = op.payload as {
      title: string; amount_paise: number; currency: string;
      split_method: string; group_id: string | null; creator_id: string;
      expense_date: string; category: string | null; notes: string | null;
      idempotency_key: string;
      payers: { userId: string; amountPaise: number }[];
      shares: { userId: string; amountPaise: number }[];
    };

    if (payload.group_id) {
      const { data: member } = await supabaseClient
        .from('group_members')
        .select('user_id')
        .eq('group_id', payload.group_id)
        .eq('user_id', payload.creator_id)
        .is('removed_at', null)
        .single();
      if (!member) {
        return { success: false, conflict: true, conflictInfo: { reason: 'No longer a member of this group' } };
      }
    }

    const { data: expense, error } = await supabaseClient
      .from('expenses')
      .insert({
        title: payload.title, amount_paise: payload.amount_paise, currency: payload.currency,
        split_method: payload.split_method as 'equal', group_id: payload.group_id,
        creator_id: payload.creator_id, expense_date: payload.expense_date,
        category: payload.category, notes: payload.notes,
        idempotency_key: payload.idempotency_key,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabaseClient
          .from('expenses').select('id').eq('idempotency_key', payload.idempotency_key).single();
        if (existing) return { success: true, serverId: existing.id };
      }
      return { success: false, error: error.message };
    }
    if (!expense) return { success: false, error: 'No expense returned' };

    await Promise.all([
      supabaseClient.from('expense_payers').insert(
        payload.payers.map((p) => ({ expense_id: expense.id, user_id: p.userId, amount_paise: p.amountPaise }))
      ),
      supabaseClient.from('expense_shares').insert(
        payload.shares.map((s) => ({ expense_id: expense.id, user_id: s.userId, amount_paise: s.amountPaise }))
      ),
    ]);

    return { success: true, serverId: expense.id };
  }

  return { success: false, error: `Unknown operation type: ${op.type}` };
}

export async function syncPendingOperations(
  supabaseClient: import('@supabase/supabase-js').SupabaseClient
): Promise<{ synced: number; failed: number; conflicts: number }> {
  const pending = await getPendingOperations();
  let synced = 0, failed = 0, conflicts = 0;

  for (const op of pending) {
    await updateOperationState(op.id, 'syncing');
    try {
      const result = await syncOperation(op, supabaseClient);
      if (result.success) {
        await markOperationSynced(op.id, result.serverId ?? op.id);
        synced++;
      } else if (result.conflict) {
        await updateOperationState(op.id, 'conflict', { conflictInfo: result.conflictInfo });
        conflicts++;
      } else {
        await updateOperationState(op.id, op.retryCount < 3 ? 'pending' : 'failed', {
          lastError: result.error, retryCount: op.retryCount + 1,
        });
        failed++;
      }
    } catch (err) {
      await updateOperationState(op.id, op.retryCount < 3 ? 'pending' : 'failed', {
        lastError: err instanceof Error ? err.message : 'Unknown error',
        retryCount: op.retryCount + 1,
      });
      failed++;
    }
  }

  return { synced, failed, conflicts };
}
