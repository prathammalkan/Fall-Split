import { describe, expect, it } from 'vitest';
import originalMigration from '../../supabase/migrations/20261026120000_bulk_delete_my_expenses.sql?raw';
import fixMigration from '../../supabase/migrations/20261026140000_fix_bulk_delete_ordering.sql?raw';
import approvalCleanupMigration from '../../supabase/migrations/20261026150000_bulk_delete_cleanup_approvals.sql?raw';

// ---------------------------------------------------------------------------
// Static source-contract tests for bulk_delete_my_expenses
//
// These tests verify the security and correctness invariants of the migration
// SQL source. They run in CI without a live database. The original migration is
// also tested to document the defects; the fix migration is tested to prove
// each defect was resolved.
// ---------------------------------------------------------------------------

describe('bulk_delete_my_expenses — source contracts', () => {
  // -------------------------------------------------------------------------
  // 1. Creator deleting an eligible expense (happy path)
  // -------------------------------------------------------------------------
  it('defines the function with SECURITY DEFINER and hardened search path', () => {
    expect(fixMigration).toContain('CREATE OR REPLACE FUNCTION public.bulk_delete_my_expenses(');
    expect(fixMigration).toContain('RETURNS JSONB');
    expect(fixMigration).toContain('LANGUAGE plpgsql');
    expect(fixMigration).toContain('SECURITY DEFINER');
    expect(fixMigration).toContain('SET search_path = pg_catalog, public, auth, pg_temp');
    expect(fixMigration).toContain('SET row_security = off');
  });

  it('enforces authentication and active account before any data access', () => {
    expect(fixMigration).toContain('auth.uid()');
    expect(fixMigration).toContain('IF v_user_id IS NULL OR NOT public.is_active_account() THEN');
    expect(fixMigration).toContain(
      "RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';"
    );
    // Auth check must come before any SELECT on expenses
    const authIdx = fixMigration.indexOf('is_active_account()');
    const selectIdx = fixMigration.indexOf('FROM public.expenses');
    expect(authIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(authIdx);
  });
  it('returns {deleted, skipped, skipped_details} on the happy-path shape', () => {
    expect(fixMigration).toContain("'deleted',         v_deleted_count");
    expect(fixMigration).toContain("'skipped',         v_skipped_count");
    expect(fixMigration).toContain("'skipped_details', v_skipped_reasons");
    expect(fixMigration).toContain('v_deleted_count := v_deleted_count + 1');
  });

  it('writes audit history before marking the expense deleted', () => {
    expect(fixMigration).toContain('INSERT INTO public.expense_history');
    const historyIdx = fixMigration.indexOf('INSERT INTO public.expense_history');
    const updateIdx = fixMigration.indexOf('UPDATE public.expenses');
    expect(historyIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(historyIdx);
    // Audit captures bulk_delete flag
    expect(fixMigration).toContain("'bulk_delete',  true");
  });

  it('marks expense deleted and removes child records after audit', () => {
    expect(fixMigration).toMatch(/UPDATE public\.expenses\s+SET\s+status\s+=\s+'deleted'/);
    expect(fixMigration).toContain(
      'DELETE FROM public.expense_items  WHERE expense_id = v_expense_id;'
    );
    expect(fixMigration).toContain(
      'DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;'
    );
    expect(fixMigration).toContain(
      'DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;'
    );
  });

  // -------------------------------------------------------------------------
  // 2. Non-creator submitting another user's expense ID
  // -------------------------------------------------------------------------
  it('skips expenses where creator_id does not match caller — reason: not_creator', () => {
    expect(fixMigration).toContain('IF v_expense.creator_id <> v_user_id THEN');
    expect(fixMigration).toContain("'reason', 'not_creator'");
    expect(fixMigration).toContain('v_skipped_count := v_skipped_count + 1');
  });

  // -------------------------------------------------------------------------
  // 3. Already-deleted expense belonging to the CALLER — idempotent success
  // -------------------------------------------------------------------------
  it('counts own already-deleted expense as idempotently done (not as skipped)', () => {
    // After ownership check, already-deleted increments deleted count
    const creatorCheckIdx = fixMigration.indexOf('IF v_expense.creator_id <> v_user_id THEN');
    const deletedCheckIdx = fixMigration.indexOf(
      "IF v_expense.status = 'deleted' THEN",
      creatorCheckIdx
    );
    const deletedIncrIdx = fixMigration.indexOf(
      'v_deleted_count := v_deleted_count + 1',
      deletedCheckIdx
    );
    expect(creatorCheckIdx).toBeGreaterThan(-1);
    expect(deletedCheckIdx).toBeGreaterThan(creatorCheckIdx); // deleted check after creator check
    expect(deletedIncrIdx).toBeGreaterThan(deletedCheckIdx);
  });

  // -------------------------------------------------------------------------
  // 4. BUG FIX: Already-deleted expense belonging to ANOTHER user must NOT
  //    increment deleted count (information disclosure in original migration)
  // -------------------------------------------------------------------------
  it('documents the original information-disclosure defect (already-deleted before creator check)', () => {
    // In the original migration, the 'already deleted' check precedes the
    // creator_id check. We assert this ordering defect exists in the original:
    const origDeletedIdx = originalMigration.indexOf("IF v_expense.status = 'deleted' THEN");
    const origCreatorIdx = originalMigration.indexOf('IF v_expense.creator_id <> v_user_id THEN');
    // Original: deleted check (72) comes before creator check (78)
    expect(origDeletedIdx).toBeGreaterThan(-1);
    expect(origCreatorIdx).toBeGreaterThan(-1);
    expect(origDeletedIdx).toBeLessThan(origCreatorIdx);
  });

  it('fixes the information-disclosure defect: creator check now precedes deleted check', () => {
    const fixCreatorIdx = fixMigration.indexOf('IF v_expense.creator_id <> v_user_id THEN');
    // Find the FIRST occurrence of the deleted check (pre-lock fast path)
    const fixDeletedIdx = fixMigration.indexOf("IF v_expense.status = 'deleted' THEN");
    // In the fix, creator check must come before the deleted check
    expect(fixCreatorIdx).toBeGreaterThan(-1);
    expect(fixDeletedIdx).toBeGreaterThan(fixCreatorIdx);
  });

  // -------------------------------------------------------------------------
  // 5. Pending settlement racing with deletion (TOCTOU fix)
  // -------------------------------------------------------------------------
  it('documents the original TOCTOU defect (settlement check before locks)', () => {
    // In the original, settlement check precedes advisory lock acquisition
    const origSettlementIdx = originalMigration.indexOf("s.status IN ('proposed', 'pending')");
    const origLockIdx = originalMigration.indexOf('pg_advisory_xact_lock');
    expect(origSettlementIdx).toBeGreaterThan(-1);
    expect(origLockIdx).toBeGreaterThan(-1);
    // Settlement check comes before the advisory lock → TOCTOU
    expect(origSettlementIdx).toBeLessThan(origLockIdx);
  });

  it('fixes the TOCTOU race: settlement check now runs after both advisory and row locks', () => {
    const fixLockIdx = fixMigration.indexOf('pg_advisory_xact_lock');
    // Find the FOR UPDATE; that is part of actual SQL (not the comment "-- 5. Re-read FOR UPDATE")
    const fixForUpdateIdx = fixMigration.indexOf('FOR UPDATE;');
    const fixSettlementIdx = fixMigration.indexOf("s.status IN ('proposed', 'pending')");

    expect(fixLockIdx).toBeGreaterThan(-1);
    expect(fixForUpdateIdx).toBeGreaterThan(fixLockIdx);
    expect(fixSettlementIdx).toBeGreaterThan(fixForUpdateIdx);
  });
  it('skips expenses blocked by a pending settlement — reason: pending_settlement', () => {
    expect(fixMigration).toContain("'reason', 'pending_settlement'");
    expect(fixMigration).toContain("s.status IN ('proposed', 'pending')");
    // Settlement check uses same group-scoped join as delete_expense
    expect(fixMigration).toContain('s.group_id IS NOT DISTINCT FROM v_expense.group_id');
  });

  // -------------------------------------------------------------------------
  // 6. Duplicate request (idempotency)
  // -------------------------------------------------------------------------
  it('deduplicates input IDs before processing to guarantee idempotent counts', () => {
    expect(fixMigration).toContain('SELECT DISTINCT unnest_id');
    expect(fixMigration).toContain('WHERE unnest_id IS NOT NULL');
  });

  it('counts a duplicate already-deleted own expense once, not twice', () => {
    // Deduplication ensures each ID appears once in v_bounded_ids; a second
    // call with the same ID on a now-deleted expense hits the idempotent branch.
    // Both are covered by: DISTINCT dedup + deleted-after-creator branch.
    expect(fixMigration).toContain("IF v_expense.status = 'deleted' THEN");
    expect(fixMigration).toContain('v_deleted_count := v_deleted_count + 1');
  });

  // -------------------------------------------------------------------------
  // 7. More than 100 requested IDs
  // -------------------------------------------------------------------------
  it('rejects arrays longer than 100 with ERRCODE 22023', () => {
    expect(fixMigration).toContain('IF pg_catalog.array_length(p_expense_ids, 1) > 100 THEN');
    expect(fixMigration).toContain(
      "RAISE EXCEPTION 'Cannot delete more than 100 expenses per call' USING ERRCODE = '22023';"
    );
  });

  // -------------------------------------------------------------------------
  // 8. Missing IDs and duplicate IDs
  // -------------------------------------------------------------------------
  it('skips NULL array with empty result rather than raising', () => {
    expect(fixMigration).toContain(
      'IF p_expense_ids IS NULL OR pg_catalog.array_length(p_expense_ids, 1) IS NULL THEN'
    );
    expect(fixMigration).toContain(
      "RETURN pg_catalog.jsonb_build_object('deleted', 0, 'skipped', 0, 'skipped_details', '[]'::JSONB);"
    );
  });

  it('skips not-found IDs with reason: not_found', () => {
    expect(fixMigration).toContain("'reason', 'not_found'");
    expect(fixMigration).toContain('IF NOT FOUND THEN');
  });

  // -------------------------------------------------------------------------
  // 9. Accurate deleted/skipped counts
  // -------------------------------------------------------------------------
  it('tracks deleted and skipped counts independently', () => {
    const deletedIncrCount = (fixMigration.match(/v_deleted_count := v_deleted_count \+ 1/g) ?? [])
      .length;
    const skippedIncrCount = (fixMigration.match(/v_skipped_count := v_skipped_count \+ 1/g) ?? [])
      .length;
    // Multiple places increment deleted (idempotent fast path + locked re-check + actual delete)
    expect(deletedIncrCount).toBeGreaterThanOrEqual(2);
    // Multiple skip reasons
    expect(skippedIncrCount).toBeGreaterThanOrEqual(4);
  });

  it('skipped_details array is appended per skipped item', () => {
    const appendCount = (fixMigration.match(/v_skipped_reasons := v_skipped_reasons \|\|/g) ?? [])
      .length;
    // Reasons: not_found, not_creator, concurrent_change (post-lock not-found),
    //          concurrent_change (post-lock creator), pending_settlement
    expect(appendCount).toBeGreaterThanOrEqual(4);
  });

  // -------------------------------------------------------------------------
  // 10. Preservation of audit history and required ledger references
  // -------------------------------------------------------------------------
  it('audit entry captures id, title, amount_paise, status, and bulk_delete flag', () => {
    expect(fixMigration).toContain("'id',           v_expense.id");
    expect(fixMigration).toContain("'title',        v_expense.title");
    expect(fixMigration).toContain("'amount_paise', v_expense.amount_paise");
    expect(fixMigration).toContain("'status',       v_expense.status");
    expect(fixMigration).toContain("'bulk_delete',  true");
  });

  it('audit change_type is "deleted" and changed_by is the authenticated caller', () => {
    expect(fixMigration).toContain("'deleted'");
    expect(fixMigration).toContain('changed_by, change_type');
    expect(fixMigration).toContain('v_user_id,');
  });

  // -------------------------------------------------------------------------
  // Locking protocol — matches delete_expense and settlement RPCs
  // -------------------------------------------------------------------------
  it('uses identical pair advisory lock key format as delete_expense', () => {
    // Both must use LEAST/GREATEST on user UUIDs cast to TEXT, joined by ':'
    expect(fixMigration).toContain("LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||");
    expect(fixMigration).toContain(
      'GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key'
    );
    expect(fixMigration).toContain('hashtextextended(v_pair_key, 0)');
  });

  it('sorts advisory locks deterministically to prevent cross-transaction deadlocks', () => {
    expect(fixMigration).toMatch(/ORDER BY pair_key/);
  });

  it('re-validates existence, creator_id, and status after acquiring FOR UPDATE lock', () => {
    const forUpdateIdx = fixMigration.indexOf('FOR UPDATE;');
    expect(forUpdateIdx).toBeGreaterThan(-1);
    const postLock = fixMigration.slice(forUpdateIdx);
    expect(postLock).toContain('IF NOT FOUND THEN');
    expect(postLock).toContain('IF v_expense.creator_id <> v_user_id THEN');
    expect(postLock).toContain("IF v_expense.status = 'deleted' THEN");
  });

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------
  it('revokes anonymous execution and grants only to authenticated', () => {
    expect(fixMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bulk_delete_my_expenses(UUID[]) FROM PUBLIC, anon;'
    );
    expect(fixMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bulk_delete_my_expenses(UUID[]) TO authenticated;'
    );
    expect(fixMigration).not.toMatch(/GRANT\s+EXECUTE.*TO\s+(PUBLIC|anon)/i);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for 20261026150000_bulk_delete_cleanup_approvals.sql
//
// Verifies that bulk_delete_my_expenses now explicitly deletes
// expense_approvals rows after soft-deleting an expense, matching the
// behaviour of delete_expense (single). Previously, bulk-delete left
// orphaned approval rows because the soft-delete (UPDATE status='deleted')
// does not trigger the ON DELETE CASCADE FK on expense_approvals.expense_id.
// ---------------------------------------------------------------------------
describe('bulk_delete_my_expenses — expense_approvals cleanup (20261026150000)', () => {
  it('imports the cleanup migration without error', () => {
    expect(typeof approvalCleanupMigration).toBe('string');
    expect(approvalCleanupMigration.length).toBeGreaterThan(0);
  });

  it('is a CREATE OR REPLACE for bulk_delete_my_expenses with SECURITY DEFINER and hardened search_path', () => {
    expect(approvalCleanupMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.bulk_delete_my_expenses('
    );
    expect(approvalCleanupMigration).toContain('SECURITY DEFINER');
    expect(approvalCleanupMigration).toContain(
      'SET search_path = pg_catalog, public, auth, pg_temp'
    );
    expect(approvalCleanupMigration).toContain('SET row_security = off');
  });

  it('explicitly deletes expense_approvals after expense_shares', () => {
    const sharesIdx = approvalCleanupMigration.indexOf(
      'DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;'
    );
    // Use lastIndexOf to skip any comment references and find the actual DELETE statement
    const approvalsIdx = approvalCleanupMigration.lastIndexOf(
      'DELETE FROM public.expense_approvals WHERE expense_id = v_expense_id;'
    );
    expect(sharesIdx).toBeGreaterThan(-1);
    expect(approvalsIdx).toBeGreaterThan(sharesIdx); // approvals deleted AFTER shares
  });

  it('still deletes expense_items, expense_payers, and expense_shares (no regression)', () => {
    expect(approvalCleanupMigration).toContain(
      'DELETE FROM public.expense_items  WHERE expense_id = v_expense_id;'
    );
    expect(approvalCleanupMigration).toContain(
      'DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;'
    );
    expect(approvalCleanupMigration).toContain(
      'DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;'
    );
  });

  it('preserves the correct ownership-before-status ordering', () => {
    const creatorIdx = approvalCleanupMigration.indexOf(
      'IF v_expense.creator_id <> v_user_id THEN'
    );
    const deletedIdx = approvalCleanupMigration.indexOf("IF v_expense.status = 'deleted' THEN");
    expect(creatorIdx).toBeGreaterThan(-1);
    expect(deletedIdx).toBeGreaterThan(creatorIdx);
  });

  it('preserves the settlement check after advisory and row locks (no TOCTOU regression)', () => {
    const lockIdx = approvalCleanupMigration.indexOf('pg_advisory_xact_lock');
    const forUpdateIdx = approvalCleanupMigration.indexOf('FOR UPDATE;');
    const settlementIdx = approvalCleanupMigration.indexOf("s.status IN ('proposed', 'pending')");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(forUpdateIdx).toBeGreaterThan(lockIdx);
    expect(settlementIdx).toBeGreaterThan(forUpdateIdx);
  });

  it('keeps the 100-ID per-call cap', () => {
    expect(approvalCleanupMigration).toContain(
      'IF pg_catalog.array_length(p_expense_ids, 1) > 100 THEN'
    );
    expect(approvalCleanupMigration).toContain(
      "RAISE EXCEPTION 'Cannot delete more than 100 expenses per call' USING ERRCODE = '22023';"
    );
  });

  it('preserves audit trail insertion before the soft-delete UPDATE', () => {
    const histIdx = approvalCleanupMigration.indexOf('INSERT INTO public.expense_history');
    const updIdx = approvalCleanupMigration.indexOf('UPDATE public.expenses');
    expect(histIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(histIdx);
  });

  it('keeps grants: anon revoked, authenticated granted', () => {
    expect(approvalCleanupMigration).toContain(
      'REVOKE ALL ON FUNCTION public.bulk_delete_my_expenses(UUID[]) FROM PUBLIC, anon;'
    );
    expect(approvalCleanupMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bulk_delete_my_expenses(UUID[]) TO authenticated;'
    );
  });

  it('is wrapped in a transaction (BEGIN / COMMIT)', () => {
    expect(approvalCleanupMigration).toMatch(/^\s*BEGIN\s*;/m);
    expect(approvalCleanupMigration).toMatch(/COMMIT\s*;\s*$/m);
  });

  it('cleanup migration adds expense_approvals DELETE that was missing in the fix migration', () => {
    // Verify the fix migration did NOT have expense_approvals cleanup (the gap we're patching)
    expect(fixMigration).not.toContain(
      'DELETE FROM public.expense_approvals WHERE expense_id = v_expense_id;'
    );
    // Verify the cleanup migration does have it
    expect(approvalCleanupMigration).toContain(
      'DELETE FROM public.expense_approvals WHERE expense_id = v_expense_id;'
    );
  });
});
