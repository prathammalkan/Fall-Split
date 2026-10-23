-- Migration: 20261024100000_owner_only_expense_deletion.sql
-- Enforce owner-only expense deletion with transaction safety,
-- pair advisory locking, child record reconciliation, and audit trail.

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_pair_key TEXT;
BEGIN
  -- 1. Authentication & Active account check
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;

  IF p_expense_id IS NULL THEN
    RAISE EXCEPTION 'Expense details are invalid' USING ERRCODE = '22023';
  END IF;

  -- 2. Read the expense record
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Strict owner authorization check
  IF v_expense.creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the expense creator may delete this expense' USING ERRCODE = '42501';
  END IF;

  -- 4. Check status
  IF v_expense.status = 'deleted' THEN
    RAISE EXCEPTION 'Expense is already deleted' USING ERRCODE = '22023';
  END IF;

  -- 5. Acquire pair advisory locks first (consistent lock ordering with update_expense_with_records and settlement RPCs)
  FOR v_pair_key IN
    SELECT DISTINCT
      LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||
      GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key
    FROM public.expense_payers AS payer
    CROSS JOIN public.expense_shares AS share
    WHERE payer.expense_id = p_expense_id
      AND share.expense_id = p_expense_id
      AND payer.user_id <> share.user_id
    ORDER BY pair_key
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pair_key, 0));
  END LOOP;

  -- 6. Lock the expense row for update after pair locks are acquired
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the expense creator may delete this expense' USING ERRCODE = '42501';
  END IF;

  IF v_expense.status = 'deleted' THEN
    RAISE EXCEPTION 'Expense is already deleted' USING ERRCODE = '22023';
  END IF;

  -- 7. Financial dependency check: verify no pending settlements between participants while holding locks
  IF EXISTS (
    SELECT 1
    FROM public.settlements AS s
    JOIN public.expense_payers AS p ON (p.expense_id = p_expense_id)
    JOIN public.expense_shares AS sh ON (sh.expense_id = p_expense_id)
    WHERE s.status IN ('proposed', 'pending')
      AND p.user_id <> sh.user_id
      AND (
        (s.payer_id = sh.user_id AND s.recipient_id = p.user_id) OR
        (s.payer_id = p.user_id AND s.recipient_id = sh.user_id)
      )
      AND (s.group_id IS NOT DISTINCT FROM v_expense.group_id)
  ) THEN
    RAISE EXCEPTION 'Cannot delete expense while a related settlement is pending confirmation'
      USING ERRCODE = '22023';
  END IF;

  -- 8. Record audit trail in expense_history
  INSERT INTO public.expense_history (
    expense_id,
    changed_by,
    change_type,
    previous_data,
    new_data,
    changed_at
  ) VALUES (
    v_expense.id,
    v_user_id,
    'deleted',
    pg_catalog.jsonb_build_object(
      'id', v_expense.id,
      'title', v_expense.title,
      'amount_paise', v_expense.amount_paise,
      'currency', v_expense.currency,
      'group_id', v_expense.group_id,
      'status', v_expense.status
    ),
    pg_catalog.jsonb_build_object(
      'status', 'deleted'
    ),
    pg_catalog.now()
  );

  -- 9. Mark expense as deleted
  UPDATE public.expenses
  SET
    status = 'deleted',
    voided_at = NULL,
    voided_by = NULL,
    void_reason = NULL,
    updated_at = pg_catalog.now()
  WHERE id = p_expense_id;

  -- 10. Clean up child records to prevent orphaned records
  DELETE FROM public.expense_items WHERE expense_id = p_expense_id;
  DELETE FROM public.expense_payers WHERE expense_id = p_expense_id;
  DELETE FROM public.expense_shares WHERE expense_id = p_expense_id;

  RETURN p_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_expense(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;
