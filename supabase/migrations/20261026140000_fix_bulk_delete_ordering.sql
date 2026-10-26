-- Migration: 20261026140000_fix_bulk_delete_ordering.sql
-- Fix two correctness defects in bulk_delete_my_expenses:
--
--   BUG 1 (information disclosure + wrong semantics):
--     The original function checked already-deleted status BEFORE checking
--     creator_id. This meant that if an already-deleted expense belonged to
--     another user, the caller received a "deleted" count increment (indicating
--     success) without ever verifying they created it. An attacker could probe
--     known expense UUIDs and infer whether they had been deleted.
--     Fix: enforce creator_id before counting anything as done.
--
--   BUG 2 (TOCTOU race on settlement check):
--     The pending-settlement EXISTS check ran before the pair advisory locks
--     and the FOR UPDATE row lock were acquired. Between the check and the
--     actual UPDATE, a concurrent propose_settlement could create a new
--     settlement, violating the "no deletion while a settlement is pending"
--     invariant. The single-delete RPC (delete_expense) correctly acquires
--     locks FIRST, then checks settlements. This function must do the same.
--     Fix: move the settlement check to after the FOR UPDATE lock, matching
--     delete_expense's proven ordering.
--
-- Correct processing order per expense ID:
--   1. Read row (unblocked initial scan for quick skips on not-found)
--   2. Check creator_id -> skip (not_creator) if mismatch
--   3. Check status = 'deleted' -> count as idempotent done ONLY after ownership verified
--   4. Acquire pair advisory locks (consistent ordering to prevent deadlocks)
--   5. Re-read FOR UPDATE
--   6. Re-validate existence + creator_id + non-deleted under lock
--   7. Check pending settlements (under lock, so concurrent proposals are blocked)
--   8. Write audit trail
--   9. UPDATE status = 'deleted'
--  10. DELETE child records

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_delete_my_expenses(
  p_expense_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_expense       public.expenses%ROWTYPE;
  v_deleted_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_skipped_reasons JSONB := '[]'::JSONB;
  v_pair_key      TEXT;
  v_expense_id    UUID;
  v_bounded_ids   UUID[];
BEGIN  -- 1. Authentication & Active account check
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;

  IF p_expense_ids IS NULL OR pg_catalog.array_length(p_expense_ids, 1) IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('deleted', 0, 'skipped', 0, 'skipped_details', '[]'::JSONB);
  END IF;

  -- 2. Bound to max 100 per call
  IF pg_catalog.array_length(p_expense_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Cannot delete more than 100 expenses per call' USING ERRCODE = '22023';
  END IF;

  -- Remove NULLs and deduplicate
  v_bounded_ids := ARRAY(
    SELECT DISTINCT unnest_id
    FROM pg_catalog.unnest(p_expense_ids) AS unnest_id
    WHERE unnest_id IS NOT NULL
  );

  -- 3. Process each expense
  FOREACH v_expense_id IN ARRAY v_bounded_ids
  LOOP
    -- Initial unblocked read for fast skips
    SELECT * INTO v_expense
    FROM public.expenses AS e
    WHERE e.id = v_expense_id;

    -- Skip if not found (no disclosure: treat same as non-creator)
    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'not_found'
      );
      CONTINUE;
    END IF;

    -- Enforce creator-only BEFORE touching deleted-status logic.
    -- This prevents disclosing whether another user's expense has been deleted.
    IF v_expense.creator_id <> v_user_id THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'not_creator'
      );
      CONTINUE;
    END IF;

    -- Idempotent: caller already deleted this expense (ownership confirmed above)
    IF v_expense.status = 'deleted' THEN
      v_deleted_count := v_deleted_count + 1;
      CONTINUE;
    END IF;

    -- Acquire pair advisory locks (consistent ordering, matching delete_expense
    -- and settlement RPCs to prevent cross-transaction deadlocks)
    FOR v_pair_key IN
      SELECT DISTINCT
        LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||
        GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key
      FROM public.expense_payers AS payer
      CROSS JOIN public.expense_shares AS share
      WHERE payer.expense_id = v_expense_id
        AND share.expense_id = v_expense_id
        AND payer.user_id <> share.user_id
      ORDER BY pair_key
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pair_key, 0));
    END LOOP;

    -- Re-read under row-level lock now that advisory locks are held.
    -- Concurrent propose_settlement is blocked here, eliminating the TOCTOU window.
    SELECT * INTO v_expense
    FROM public.expenses AS e
    WHERE e.id = v_expense_id
    FOR UPDATE;

    -- Re-validate under lock
    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'concurrent_change'
      );
      CONTINUE;
    END IF;

    IF v_expense.creator_id <> v_user_id THEN
      -- Concurrent ownership change (edge case; treat as access denied)
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'concurrent_change'
      );
      CONTINUE;
    END IF;

    IF v_expense.status = 'deleted' THEN
      -- Concurrent deletion by the same creator in another session
      v_deleted_count := v_deleted_count + 1;
      CONTINUE;
    END IF;

    -- Check pending settlements AFTER acquiring locks (eliminating TOCTOU race).
    -- A concurrent propose_settlement that would create a relevant settlement is
    -- now blocked by the advisory lock on the same user pair until this
    -- transaction commits or rolls back.
    IF EXISTS (
      SELECT 1
      FROM public.settlements AS s
      JOIN public.expense_payers AS p ON (p.expense_id = v_expense_id)
      JOIN public.expense_shares AS sh ON (sh.expense_id = v_expense_id)
      WHERE s.status IN ('proposed', 'pending')
        AND p.user_id <> sh.user_id
        AND (
          (s.payer_id = sh.user_id AND s.recipient_id = p.user_id) OR
          (s.payer_id = p.user_id AND s.recipient_id = sh.user_id)
        )
        AND (s.group_id IS NOT DISTINCT FROM v_expense.group_id)
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'pending_settlement'
      );
      CONTINUE;
    END IF;

    -- Write audit trail before mutation
    INSERT INTO public.expense_history (
      expense_id, changed_by, change_type, previous_data, new_data, changed_at
    ) VALUES (
      v_expense.id,
      v_user_id,
      'deleted',
      pg_catalog.jsonb_build_object(
        'id',           v_expense.id,
        'title',        v_expense.title,
        'amount_paise', v_expense.amount_paise,
        'status',       v_expense.status,
        'bulk_delete',  true
      ),
      pg_catalog.jsonb_build_object('status', 'deleted'),
      pg_catalog.now()
    );

    -- Mark as deleted
    UPDATE public.expenses
    SET
      status     = 'deleted',
      voided_at  = NULL,
      voided_by  = NULL,
      void_reason = NULL,
      updated_at = pg_catalog.now()
    WHERE id = v_expense_id;

    -- Clean up child records
    DELETE FROM public.expense_items  WHERE expense_id = v_expense_id;
    DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;
    DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;

    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'deleted',         v_deleted_count,
    'skipped',         v_skipped_count,
    'skipped_details', v_skipped_reasons
  );
END;
$function$;

-- Grants are unchanged: anon stays revoked, authenticated stays granted
REVOKE ALL ON FUNCTION public.bulk_delete_my_expenses(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_delete_my_expenses(UUID[]) TO authenticated;

COMMIT;
