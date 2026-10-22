-- Create or reconcile an expense and its payer/share ledger in one transaction.
-- A retry with the same key repairs missing rows, but never overwrites conflicting
-- records or treats the expense header alone as proof of completion.
CREATE OR REPLACE FUNCTION public.create_expense_with_records(
  p_expense JSONB,
  p_payers JSONB,
  p_shares JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_creator_id UUID;
  v_idempotency_key TEXT;
  v_title TEXT;
  v_amount_paise BIGINT;
  v_currency TEXT;
  v_split_method public.split_method;
  v_group_id UUID;
  v_expense_date DATE;
  v_category TEXT;
  v_notes TEXT;
  v_expense public.expenses%ROWTYPE;
  v_expense_id UUID;
  v_payer_count BIGINT;
  v_payer_user_count BIGINT;
  v_payer_distinct_user_count BIGINT;
  v_payer_amount_count BIGINT;
  v_payer_total NUMERIC;
  v_share_count BIGINT;
  v_share_user_count BIGINT;
  v_share_distinct_user_count BIGINT;
  v_share_amount_count BIGINT;
  v_share_total NUMERIC;
  v_persisted_payer_count BIGINT;
  v_persisted_payer_total NUMERIC;
  v_persisted_share_count BIGINT;
  v_persisted_share_total NUMERIC;
  v_restore_voided BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_expense) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_payers) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(p_shares) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expense, payer, and share payloads have invalid shapes' USING ERRCODE = '22023';
  END IF;

  v_creator_id := (p_expense->>'creator_id')::UUID;
  v_idempotency_key := pg_catalog.btrim(p_expense->>'idempotency_key');
  v_title := pg_catalog.btrim(p_expense->>'title');
  v_amount_paise := (p_expense->>'amount_paise')::BIGINT;
  v_currency := p_expense->>'currency';
  v_split_method := (p_expense->>'split_method')::public.split_method;
  v_group_id := NULLIF(p_expense->>'group_id', '')::UUID;
  v_expense_date := (p_expense->>'expense_date')::DATE;
  v_category := NULLIF(p_expense->>'category', 'null');
  v_notes := NULLIF(p_expense->>'notes', 'null');

  IF v_creator_id IS NULL OR v_creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Expense creator must be the authenticated user' USING ERRCODE = '42501';
  END IF;
  IF v_idempotency_key IS NULL OR pg_catalog.char_length(v_idempotency_key) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'A valid expense idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF v_title IS NULL OR pg_catalog.char_length(v_title) NOT BETWEEN 1 AND 120
    OR v_amount_paise IS NULL OR v_amount_paise <= 0
    OR v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$'
    OR v_split_method IS NULL OR v_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense details are invalid' USING ERRCODE = '22023';
  END IF;
  IF v_group_id IS NOT NULL AND NOT public.is_group_member(v_user_id, v_group_id) THEN
    RAISE EXCEPTION 'Active group membership required to create this expense' USING ERRCODE = '42501';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(payer."userId"),
    pg_catalog.count(DISTINCT payer."userId"),
    pg_catalog.count(payer."amountPaise"),
    COALESCE(pg_catalog.sum(payer."amountPaise"), 0)
  INTO v_payer_count, v_payer_user_count, v_payer_distinct_user_count, v_payer_amount_count, v_payer_total
  FROM pg_catalog.jsonb_to_recordset(p_payers) AS payer("userId" UUID, "amountPaise" BIGINT);

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(share."userId"),
    pg_catalog.count(DISTINCT share."userId"),
    pg_catalog.count(share."amountPaise"),
    COALESCE(pg_catalog.sum(share."amountPaise"), 0)
  INTO v_share_count, v_share_user_count, v_share_distinct_user_count, v_share_amount_count, v_share_total
  FROM pg_catalog.jsonb_to_recordset(p_shares) AS share("userId" UUID, "amountPaise" BIGINT);

  IF v_payer_count = 0 OR v_payer_user_count <> v_payer_count
    OR v_payer_distinct_user_count <> v_payer_count
    OR v_payer_amount_count <> v_payer_count OR v_payer_total <> v_amount_paise
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_payers) AS payer("amountPaise" BIGINT)
      WHERE payer."amountPaise" <= 0
    ) THEN
    RAISE EXCEPTION 'Payer contributions must be unique, positive, and equal the expense total'
      USING ERRCODE = '23514';
  END IF;
  IF v_share_count = 0 OR v_share_user_count <> v_share_count
    OR v_share_distinct_user_count <> v_share_count
    OR v_share_amount_count <> v_share_count OR v_share_total <> v_amount_paise
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_shares) AS share("amountPaise" BIGINT)
      WHERE share."amountPaise" < 0
    ) THEN
    RAISE EXCEPTION 'Participant shares must be unique, non-negative, and equal the expense total'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idempotency_key, 0));

  SELECT *
  INTO v_expense
  FROM public.expenses
  WHERE idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_expense.creator_id <> v_creator_id
      OR v_expense.title IS DISTINCT FROM v_title
      OR v_expense.amount_paise IS DISTINCT FROM v_amount_paise
      OR v_expense.currency IS DISTINCT FROM v_currency
      OR v_expense.split_method IS DISTINCT FROM v_split_method
      OR v_expense.group_id IS DISTINCT FROM v_group_id
      OR v_expense.expense_date IS DISTINCT FROM v_expense_date
      OR v_expense.category IS DISTINCT FROM v_category
      OR v_expense.notes IS DISTINCT FROM v_notes THEN
      RAISE EXCEPTION 'Expense idempotency key was already used for different details'
        USING ERRCODE = '22023';
    END IF;
    IF v_expense.status = 'voided' AND v_expense.void_reason = 'Payers/shares insert failed' THEN
      v_restore_voided := TRUE;
    ELSIF v_expense.status <> 'active' THEN
      RAISE EXCEPTION 'Expense exists in a non-active state and requires manual reconciliation'
        USING ERRCODE = '22023';
    END IF;
    v_expense_id := v_expense.id;
  ELSE
    INSERT INTO public.expenses (
      title, amount_paise, currency, split_method, group_id, creator_id,
      expense_date, category, notes, idempotency_key
    )
    VALUES (
      v_title, v_amount_paise, v_currency, v_split_method, v_group_id, v_creator_id,
      v_expense_date, v_category, v_notes, v_idempotency_key
    )
    RETURNING id INTO v_expense_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_payers AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_payers)
      AS expected("userId" UUID, "amountPaise" BIGINT)
      ON expected."userId" = existing.user_id
    WHERE existing.expense_id = v_expense_id
      AND (expected."userId" IS NULL OR expected."amountPaise" IS DISTINCT FROM existing.amount_paise)
  ) THEN
    RAISE EXCEPTION 'Existing payer records conflict with the retry payload' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.expense_payers (expense_id, user_id, amount_paise)
  SELECT v_expense_id, expected."userId", expected."amountPaise"
  FROM pg_catalog.jsonb_to_recordset(p_payers) AS expected("userId" UUID, "amountPaise" BIGINT)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_payers AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  IF EXISTS (
    SELECT 1
    FROM public.expense_shares AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_shares)
      AS expected("userId" UUID, "amountPaise" BIGINT)
      ON expected."userId" = existing.user_id
    WHERE existing.expense_id = v_expense_id
      AND (expected."userId" IS NULL OR expected."amountPaise" IS DISTINCT FROM existing.amount_paise)
  ) THEN
    RAISE EXCEPTION 'Existing participant-share records conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.expense_shares (expense_id, user_id, amount_paise, percentage, share_weight)
  SELECT
    v_expense_id,
    expected."userId",
    expected."amountPaise",
    expected.percentage,
    expected."shareWeight"
  FROM pg_catalog.jsonb_to_recordset(p_shares)
    AS expected("userId" UUID, "amountPaise" BIGINT, percentage NUMERIC, "shareWeight" NUMERIC)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_shares AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(amount_paise), 0)
  INTO v_persisted_payer_count, v_persisted_payer_total
  FROM public.expense_payers
  WHERE expense_id = v_expense_id;
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(amount_paise), 0)
  INTO v_persisted_share_count, v_persisted_share_total
  FROM public.expense_shares
  WHERE expense_id = v_expense_id;

  IF v_persisted_payer_count <> v_payer_count
    OR v_persisted_payer_total <> v_amount_paise
    OR v_persisted_share_count <> v_share_count
    OR v_persisted_share_total <> v_amount_paise THEN
    RAISE EXCEPTION 'Persisted payer and participant records do not reconcile with the expense total'
      USING ERRCODE = '23514';
  END IF;

  IF v_restore_voided THEN
    UPDATE public.expenses
    SET status = 'active', voided_at = NULL, voided_by = NULL, void_reason = NULL
    WHERE id = v_expense_id;
  END IF;

  RETURN v_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) TO authenticated;
