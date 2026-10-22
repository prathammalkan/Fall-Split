-- Persist itemized lines and allocations in the same transaction as the
-- expense, payer contributions, and participant shares.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_items_expense_sort_order
  ON public.expense_items (expense_id, sort_order);

CREATE OR REPLACE FUNCTION public.create_itemized_expense_with_records(
  p_expense JSONB,
  p_payers JSONB,
  p_shares JSONB,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_expense_id UUID;
  v_amount_paise BIGINT;
  v_split_method public.split_method;
  v_item_count BIGINT;
  v_distinct_sort_count BIGINT;
  v_named_item_count BIGINT;
  v_item_total NUMERIC;
  v_expected_allocation_count BIGINT;
  v_persisted_item_count BIGINT;
  v_persisted_allocation_count BIGINT;
BEGIN
  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Itemized expense payload must be an array' USING ERRCODE = '22023';
  END IF;

  v_expense_id := public.create_expense_with_records(p_expense, p_payers, p_shares);
  v_amount_paise := (p_expense->>'amount_paise')::BIGINT;
  v_split_method := (p_expense->>'split_method')::public.split_method;

  IF v_split_method <> 'itemized' THEN
    RAISE EXCEPTION 'Itemized expense RPC requires the itemized split method' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Itemized expenses require at least one item' USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT item.sort_order),
    pg_catalog.count(item.name),
    COALESCE(pg_catalog.sum(item.total_paise), 0)
  INTO v_item_count, v_distinct_sort_count, v_named_item_count, v_item_total
  FROM pg_catalog.jsonb_to_recordset(p_items) AS item(
    name TEXT,
    quantity NUMERIC,
    unit_price_paise BIGINT,
    total_paise BIGINT,
    sort_order INTEGER,
    allocations JSONB
  );

  IF v_item_count <> v_distinct_sort_count
    OR v_item_count <> v_named_item_count
    OR v_item_total <> v_amount_paise THEN
    RAISE EXCEPTION 'Item totals and ordering must reconcile with the expense'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS item(
      name TEXT,
      quantity NUMERIC,
      unit_price_paise BIGINT,
      total_paise BIGINT,
      sort_order INTEGER,
      allocations JSONB
    )
    WHERE item.name IS NULL
      OR pg_catalog.char_length(pg_catalog.btrim(item.name)) NOT BETWEEN 1 AND 100
      OR item.quantity IS NULL
      OR item.quantity <= 0
      OR item.unit_price_paise IS NULL
      OR item.unit_price_paise < 0
      OR item.total_paise IS NULL
      OR item.total_paise < 0
      OR item.sort_order IS NULL
      OR item.sort_order < 0
      OR pg_catalog.round(item.unit_price_paise::NUMERIC * item.quantity) <> item.total_paise
      OR pg_catalog.jsonb_typeof(item.allocations) IS DISTINCT FROM 'array'
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ) = 0
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
        WHERE allocation."userId" IS NULL
          OR allocation."amountPaise" IS NULL
          OR allocation."amountPaise" < 0
      ) > 0
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ) <> (
        SELECT pg_catalog.count(DISTINCT allocation."userId")
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      )
      OR COALESCE((
        SELECT pg_catalog.sum(allocation."amountPaise")
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ), 0) <> item.total_paise
  ) THEN
    RAISE EXCEPTION 'Item details and participant allocations are invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH item_allocations AS (
      SELECT allocation."userId" AS user_id,
        pg_catalog.sum(allocation."amountPaise") AS amount_paise
      FROM pg_catalog.jsonb_to_recordset(p_items) AS item(allocations JSONB)
      CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
        "userId" UUID,
        "amountPaise" BIGINT
      )
      GROUP BY allocation."userId"
    ),
    expected_shares AS (
      SELECT share."userId" AS user_id,
        pg_catalog.sum(share."amountPaise") AS amount_paise
      FROM pg_catalog.jsonb_to_recordset(p_shares) AS share(
        "userId" UUID,
        "amountPaise" BIGINT
      )
      GROUP BY share."userId"
    )
    SELECT 1
    FROM item_allocations
    FULL OUTER JOIN expected_shares USING (user_id)
    WHERE item_allocations.amount_paise IS DISTINCT FROM expected_shares.amount_paise
  ) THEN
    RAISE EXCEPTION 'Item allocations must match participant shares'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_items AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected(
      name TEXT,
      quantity NUMERIC,
      unit_price_paise BIGINT,
      total_paise BIGINT,
      sort_order INTEGER,
      allocations JSONB
    ) ON expected.sort_order = existing.sort_order
    WHERE existing.expense_id = v_expense_id
      AND (
        expected.sort_order IS NULL
        OR existing.name IS DISTINCT FROM pg_catalog.btrim(expected.name)
        OR existing.quantity IS DISTINCT FROM expected.quantity
        OR existing.unit_price_paise IS DISTINCT FROM expected.unit_price_paise
        OR existing.total_paise IS DISTINCT FROM expected.total_paise
      )
  ) THEN
    RAISE EXCEPTION 'Existing item records conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.expense_items (
    expense_id, name, quantity, unit_price_paise, total_paise, sort_order
  )
  SELECT
    v_expense_id,
    pg_catalog.btrim(expected.name),
    expected.quantity,
    expected.unit_price_paise,
    expected.total_paise,
    expected.sort_order
  FROM pg_catalog.jsonb_to_recordset(p_items) AS expected(
    name TEXT,
    quantity NUMERIC,
    unit_price_paise BIGINT,
    total_paise BIGINT,
    sort_order INTEGER,
    allocations JSONB
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_items AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.sort_order = expected.sort_order
  );

  IF EXISTS (
    SELECT 1
    FROM public.expense_item_allocations AS existing
    JOIN public.expense_items AS item ON item.id = existing.item_id
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected_item(
      sort_order INTEGER,
      allocations JSONB
    ) ON expected_item.sort_order = item.sort_order
    LEFT JOIN LATERAL pg_catalog.jsonb_to_recordset(expected_item.allocations) AS expected_allocation(
      "userId" UUID,
      "amountPaise" BIGINT
    ) ON expected_allocation."userId" = existing.user_id
    WHERE item.expense_id = v_expense_id
      AND (
        expected_item.sort_order IS NULL
        OR expected_allocation."userId" IS NULL
        OR expected_allocation."amountPaise" IS DISTINCT FROM existing.amount_paise
      )
  ) THEN
    RAISE EXCEPTION 'Existing item allocations conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.expense_item_allocations (item_id, user_id, amount_paise)
  SELECT item.id, allocation."userId", allocation."amountPaise"
  FROM public.expense_items AS item
  JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected_item(
    sort_order INTEGER,
    allocations JSONB
  ) ON expected_item.sort_order = item.sort_order
  CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(expected_item.allocations) AS allocation(
    "userId" UUID,
    "amountPaise" BIGINT
  )
  WHERE item.expense_id = v_expense_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.expense_item_allocations AS existing
      WHERE existing.item_id = item.id
        AND existing.user_id = allocation."userId"
    );

  SELECT COALESCE(pg_catalog.sum(expected.allocation_count), 0)
  INTO v_expected_allocation_count
  FROM (
    SELECT pg_catalog.count(*) AS allocation_count
    FROM pg_catalog.jsonb_to_recordset(p_items) AS item(allocations JSONB)
    CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
      "userId" UUID,
      "amountPaise" BIGINT
    )
  ) AS expected;

  SELECT pg_catalog.count(*)
  INTO v_persisted_item_count
  FROM public.expense_items
  WHERE expense_id = v_expense_id;

  SELECT pg_catalog.count(*)
  INTO v_persisted_allocation_count
  FROM public.expense_item_allocations AS allocation
  JOIN public.expense_items AS item ON item.id = allocation.item_id
  WHERE item.expense_id = v_expense_id;

  IF v_persisted_item_count <> v_item_count
    OR v_persisted_allocation_count <> v_expected_allocation_count THEN
    RAISE EXCEPTION 'Persisted item records do not match the retry payload'
      USING ERRCODE = '23514';
  END IF;

  RETURN v_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_itemized_expense_with_records(JSONB, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_itemized_expense_with_records(JSONB, JSONB, JSONB, JSONB)
  TO authenticated;
