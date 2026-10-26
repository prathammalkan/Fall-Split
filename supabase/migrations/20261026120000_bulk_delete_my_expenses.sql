-- Migration: 20261026120000_bulk_delete_my_expenses.sql
-- Add bulk delete RPC for creator-owned expenses.
-- Invariants:
--   1. Caller must be active and authenticated.
--   2. Only deletes expenses where caller is creator_id.
--   3. Cannot delete expenses that have a pending settlement between participants.
--   4. Writes audit trail entries for each deleted expense.
--   5. Bounded to max 100 expenses per call to prevent abuse.
--   6. Returns count of deleted expenses.
--   7. Idempotent: already-deleted expenses are counted as already done.

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
  v_user_id UUID := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_deleted_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_skipped_reasons JSONB := '[]'::JSONB;
  v_pair_key TEXT;
  v_expense_id UUID;
  v_bounded_ids UUID[];
BEGIN
  -- 1. Authentication & Active account check
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
    -- Read the expense
    SELECT * INTO v_expense
    FROM public.expenses AS e
    WHERE e.id = v_expense_id;

    -- Skip if not found
    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'not_found'
      );
      CONTINUE;
    END IF;

    -- Skip if already deleted (idempotent)
    IF v_expense.status = 'deleted' THEN
      v_deleted_count := v_deleted_count + 1; -- count as done
      CONTINUE;
    END IF;

    -- Enforce creator-only
    IF v_expense.creator_id <> v_user_id THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
        'id', v_expense_id,
        'reason', 'not_creator'
      );
      CONTINUE;
    END IF;

    -- Check for pending settlements between participants
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

    -- Acquire pair advisory locks (consistent ordering)
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

    -- Lock expense row
    SELECT * INTO v_expense
    FROM public.expenses AS e
    WHERE e.id = v_expense_id
    FOR UPDATE;

    -- Re-check after lock
    IF NOT FOUND OR v_expense.creator_id <> v_user_id OR v_expense.status = 'deleted' THEN
      IF FOUND AND v_expense.status = 'deleted' THEN
        v_deleted_count := v_deleted_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
        v_skipped_reasons := v_skipped_reasons || pg_catalog.jsonb_build_object(
          'id', v_expense_id,
          'reason', 'concurrent_change'
        );
      END IF;
      CONTINUE;
    END IF;

    -- Write audit trail
    INSERT INTO public.expense_history (
      expense_id, changed_by, change_type, previous_data, new_data, changed_at
    ) VALUES (
      v_expense.id,
      v_user_id,
      'deleted',
      pg_catalog.jsonb_build_object(
        'id', v_expense.id,
        'title', v_expense.title,
        'amount_paise', v_expense.amount_paise,
        'status', v_expense.status,
        'bulk_delete', true
      ),
      pg_catalog.jsonb_build_object('status', 'deleted'),
      pg_catalog.now()
    );

    -- Mark as deleted
    UPDATE public.expenses
    SET
      status = 'deleted',
      voided_at = NULL,
      voided_by = NULL,
      void_reason = NULL,
      updated_at = pg_catalog.now()
    WHERE id = v_expense_id;

    -- Clean up child records
    DELETE FROM public.expense_items WHERE expense_id = v_expense_id;
    DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;
    DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;

    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'deleted', v_deleted_count,
    'skipped', v_skipped_count,
    'skipped_details', v_skipped_reasons
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_delete_my_expenses(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_delete_my_expenses(UUID[]) TO authenticated;

COMMIT;
