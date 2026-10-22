-- Keep group setup and expense edits atomic, caller-bound database operations.

CREATE OR REPLACE FUNCTION public.create_group_with_owner(
  p_name TEXT,
  p_description TEXT,
  p_type public.group_type
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_group_id UUID;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80
    OR (p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 200)
    OR p_type IS NULL THEN
    RAISE EXCEPTION 'Group details are invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.groups (name, description, type, currency, creator_id)
  VALUES (pg_catalog.btrim(p_name), NULLIF(pg_catalog.btrim(p_description), ''), p_type, 'INR', v_user_id)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, v_user_id, 'admin');

  RETURN v_group_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group_with_owner(TEXT, TEXT, public.group_type)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_with_owner(TEXT, TEXT, public.group_type)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.update_expense_with_records(
  p_expense_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_title TEXT,
  p_amount_paise BIGINT,
  p_expense_date DATE,
  p_notes TEXT,
  p_category TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_payer_count BIGINT;
  v_payer_total NUMERIC;
  v_share_count BIGINT;
  v_share_total NUMERIC;
  v_pair_key TEXT;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_expense_id IS NULL OR p_expected_updated_at IS NULL
    OR p_title IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 1 AND 120
    OR p_amount_paise IS NULL OR p_amount_paise <= 0
    OR p_expense_date IS NULL
    OR (p_notes IS NOT NULL AND pg_catalog.char_length(p_notes) > 500)
    OR (p_category IS NOT NULL AND pg_catalog.char_length(p_category) > 80) THEN
    RAISE EXCEPTION 'Expense details are invalid' USING ERRCODE = '22023';
  END IF;

  -- Read the immutable participant set without taking the expense row lock.
  -- Settlement RPCs acquire pair advisory locks before settlement row locks;
  -- taking this row lock before those same pair locks would invert lock order.
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id OR v_expense.status <> 'active' THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;
  IF v_expense.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Expense changed since it was opened; reload and retry'
      USING ERRCODE = '40001';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND v_expense.split_method <> 'equal' THEN
    RAISE EXCEPTION 'Only equal-split amounts can be recalculated automatically'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise AND EXISTS (
    SELECT 1 FROM public.expense_items AS item WHERE item.expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Itemized expense amounts must be edited with their line allocations'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(payer.amount_paise), 0)
  INTO v_payer_count, v_payer_total
  FROM public.expense_payers AS payer
  WHERE payer.expense_id = p_expense_id;
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(share.amount_paise), 0)
  INTO v_share_count, v_share_total
  FROM public.expense_shares AS share
  WHERE share.expense_id = p_expense_id;

  IF v_payer_count = 0 OR v_share_count = 0
    OR v_payer_total <> v_expense.amount_paise
    OR v_share_total <> v_expense.amount_paise THEN
    RAISE EXCEPTION 'Existing expense payer and share totals do not reconcile'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise THEN
    IF p_amount_paise < v_payer_count THEN
      RAISE EXCEPTION 'Updated total is too small to retain every payer'
        USING ERRCODE = '23514';
    END IF;

    -- Global lock order: pair advisory locks first, then the expense row.
    -- Settlement RPCs likewise acquire their pair lock before locking a
    -- settlement row. Sort pair keys so edits involving several pairs agree.
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
  END IF;

  -- Re-read and lock only after any required pair locks are held. A competing
  -- edit may have completed while we waited; preserve optimistic stale-write
  -- rejection and do not update from an obsolete header.
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id OR v_expense.status <> 'active' THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;
  IF v_expense.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Expense changed since it was opened; reload and retry'
      USING ERRCODE = '40001';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND v_expense.split_method <> 'equal' THEN
    RAISE EXCEPTION 'Only equal-split amounts can be recalculated automatically' USING ERRCODE = '22023';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND EXISTS (
    SELECT 1 FROM public.expense_items AS item WHERE item.expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Itemized expense amounts must be edited with their line allocations'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise THEN
    WITH participants AS (
      SELECT
        share.id,
        pg_catalog.row_number() OVER (ORDER BY share.user_id) AS position,
        pg_catalog.count(*) OVER () AS participant_count
      FROM public.expense_shares AS share
      WHERE share.expense_id = p_expense_id
    )
    UPDATE public.expense_shares AS share
    SET amount_paise = (p_amount_paise / participants.participant_count)
      + CASE WHEN participants.position <= p_amount_paise % participants.participant_count THEN 1 ELSE 0 END,
      percentage = NULL,
      share_weight = NULL
    FROM participants
    WHERE share.id = participants.id;

    WITH raw_amounts AS (
      SELECT
        payer.id,
        payer.user_id,
      payer.amount_paise::NUMERIC * (p_amount_paise - v_payer_count)::NUMERIC
          / v_expense.amount_paise::NUMERIC AS exact_amount
      FROM public.expense_payers AS payer
      WHERE payer.expense_id = p_expense_id
    ),
    base_amounts AS (
      SELECT
        raw_amounts.id,
        raw_amounts.user_id,
        pg_catalog.floor(raw_amounts.exact_amount)::BIGINT AS base_amount,
        raw_amounts.exact_amount - pg_catalog.floor(raw_amounts.exact_amount) AS remainder
      FROM raw_amounts
    ),
    ranked_amounts AS (
      SELECT
        base_amounts.id,
        base_amounts.base_amount,
        pg_catalog.row_number() OVER (
          ORDER BY base_amounts.remainder DESC, base_amounts.user_id
        ) AS remainder_rank,
        pg_catalog.sum(base_amounts.base_amount) OVER () AS base_total
      FROM base_amounts
    )
    UPDATE public.expense_payers AS payer
    SET amount_paise = 1 + ranked_amounts.base_amount
      + CASE WHEN ranked_amounts.remainder_rank <= p_amount_paise - v_payer_count - ranked_amounts.base_total THEN 1 ELSE 0 END
    FROM ranked_amounts
    WHERE payer.id = ranked_amounts.id;
  END IF;

  UPDATE public.expenses AS expense
  SET title = pg_catalog.btrim(p_title),
      amount_paise = p_amount_paise,
      expense_date = p_expense_date,
      notes = NULLIF(pg_catalog.btrim(p_notes), ''),
      category = NULLIF(pg_catalog.btrim(p_category), '')
  WHERE expense.id = p_expense_id;

  RETURN p_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) TO authenticated;
