import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20261024100000_owner_only_expense_deletion.sql?raw';
import settlementMigration from '../../supabase/migrations/009_settlement_integrity.sql?raw';

describe('Owner-only expense deletion migration', () => {
  it('defines delete_expense with SECURITY DEFINER and hardened search path', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id UUID)'
    );
    expect(migration).toContain('RETURNS UUID');
    expect(migration).toContain('LANGUAGE plpgsql');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public, auth, pg_temp');
    expect(migration).toContain('SET row_security = off');
  });

  it('enforces caller authentication and active account checks', () => {
    expect(migration).toContain('v_user_id UUID := auth.uid();');
    expect(migration).toContain('IF v_user_id IS NULL OR NOT public.is_active_account() THEN');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';"
    );
  });

  it('strictly validates ownership against the trusted database record', () => {
    expect(migration).toMatch(
      /SELECT \* INTO v_expense\s+FROM public\.expenses AS expense\s+WHERE expense\.id = p_expense_id;/
    );
    expect(migration).toContain("RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';");
    expect(migration).toContain('IF v_expense.creator_id <> v_user_id THEN');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Only the expense creator may delete this expense' USING ERRCODE = '42501';"
    );
  });

  it('rejects deletion of already deleted expenses', () => {
    expect(migration).toContain("IF v_expense.status = 'deleted' THEN");
    expect(migration).toContain(
      "RAISE EXCEPTION 'Expense is already deleted' USING ERRCODE = '22023';"
    );
  });

  it('guards ledger integrity against pending settlements between participants', () => {
    expect(migration).toContain("s.status IN ('proposed', 'pending')");
    expect(migration).toContain('WHERE s.status IN');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Cannot delete expense while a related settlement is pending confirmation'"
    );
    expect(migration).toContain("USING ERRCODE = '22023'");
  });

  it('acquires pair advisory locks and row locks before mutation to prevent race conditions', () => {
    expect(migration).toContain(
      'pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pair_key, 0))'
    );
    expect(migration).toContain('FOR UPDATE');

    const advisoryLockIndex = migration.indexOf('pg_catalog.pg_advisory_xact_lock');
    const settlementCheckIndex = migration.indexOf("s.status IN ('proposed', 'pending')");
    const updateIndex = migration.indexOf('UPDATE public.expenses');

    expect(advisoryLockIndex).toBeGreaterThan(-1);
    expect(settlementCheckIndex).toBeGreaterThan(advisoryLockIndex);
    expect(updateIndex).toBeGreaterThan(settlementCheckIndex);
  });

  it('revalidates existence, ownership, and non-deleted status under the row-level FOR UPDATE lock', () => {
    const forUpdateIndex = migration.indexOf('FOR UPDATE;');
    expect(forUpdateIndex).toBeGreaterThan(-1);

    const postLockSegment = migration.slice(forUpdateIndex);
    expect(postLockSegment).toContain(
      "RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';"
    );
    expect(postLockSegment).toContain(
      "RAISE EXCEPTION 'Only the expense creator may delete this expense' USING ERRCODE = '42501';"
    );
    expect(postLockSegment).toContain(
      "RAISE EXCEPTION 'Expense is already deleted' USING ERRCODE = '22023';"
    );
  });

  it('sorts pair advisory locks deterministically to avoid cross-transaction deadlocks', () => {
    expect(migration).toMatch(/ORDER BY pair_key/);
    expect(migration).toContain("LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||");
    expect(migration).toContain('GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key');
  });

  it('uses pair advisory lock key format identical to settlement integrity RPCs', () => {
    expect(settlementMigration).toContain(
      "LEAST(v_payer_id::TEXT, p_recipient_id::TEXT) || ':' ||"
    );
    expect(settlementMigration).toContain('GREATEST(v_payer_id::TEXT, p_recipient_id::TEXT), 0');
    expect(migration).toContain("LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||");
    expect(migration).toContain('GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key');
    expect(settlementMigration).toContain('hashtextextended(');
    expect(migration).toContain('hashtextextended(v_pair_key, 0)');
  });

  it('records audit history before updating expense status', () => {
    expect(migration).toContain('INSERT INTO public.expense_history');
    expect(migration).toContain("'deleted'");
    expect(migration).toMatch(/pg_catalog\.jsonb_build_object\s*\(\s*'status',\s*'deleted'\s*\)/);

    const historyIndex = migration.indexOf('INSERT INTO public.expense_history');
    const updateIndex = migration.indexOf('UPDATE public.expenses');
    expect(historyIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(historyIndex);
  });

  it('marks expense status as deleted and clears child records to prevent orphans', () => {
    expect(migration).toMatch(/UPDATE public\.expenses\s+SET\s+status = 'deleted'/);
    expect(migration).toContain(
      'DELETE FROM public.expense_items WHERE expense_id = p_expense_id;'
    );
    expect(migration).toContain(
      'DELETE FROM public.expense_payers WHERE expense_id = p_expense_id;'
    );
    expect(migration).toContain(
      'DELETE FROM public.expense_shares WHERE expense_id = p_expense_id;'
    );
  });

  it('revokes anonymous execution and grants execute only to authenticated users', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.delete_expense(UUID) FROM PUBLIC, anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;'
    );
    expect(migration).not.toMatch(/GRANT\s+EXECUTE.*TO\s+(PUBLIC|anon)/i);
  });
});
