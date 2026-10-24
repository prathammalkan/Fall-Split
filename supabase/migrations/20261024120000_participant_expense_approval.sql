-- Migration: 20261024120000_participant_expense_approval.sql
-- Description: Implement participant approval workflow before expense confirmation.
-- Invariants:
--   1. An expense with multiple participants starts in 'pending_approval' (or 'confirmed' if single participant).
--   2. All non-creator participants must approve via respond_to_expense_approval().
--   3. When all required approvals are recorded, expense status becomes 'confirmed'.
--   4. Disputed expenses record category & reason and remain unconfirmed.
--   5. Only 'active' and 'confirmed' expenses affect balances in expense_pair_allocations().

BEGIN;

-- 1. Extend expense_status enum with new approval states if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_approval' AND enumtypid = 'public.expense_status'::regtype) THEN
    ALTER TYPE public.expense_status ADD VALUE 'pending_approval';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'disputed' AND enumtypid = 'public.expense_status'::regtype) THEN
    ALTER TYPE public.expense_status ADD VALUE 'disputed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'confirmed' AND enumtypid = 'public.expense_status'::regtype) THEN
    ALTER TYPE public.expense_status ADD VALUE 'confirmed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = 'public.expense_status'::regtype) THEN
    ALTER TYPE public.expense_status ADD VALUE 'cancelled';
  END IF;
END$$;

COMMIT;

BEGIN;

-- 2. Create expense_approvals table
CREATE TABLE IF NOT EXISTS public.expense_approvals (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id       UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending',
  dispute_reason   TEXT,
  dispute_category TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at     TIMESTAMPTZ,

  CONSTRAINT unique_expense_participant_approval UNIQUE (expense_id, user_id),
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'disputed')),
  CONSTRAINT dispute_reason_length CHECK (
    dispute_reason IS NULL OR char_length(dispute_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense_id ON public.expense_approvals (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_user_id ON public.expense_approvals (user_id);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_status ON public.expense_approvals (status);

-- 3. Enable RLS on expense_approvals
ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_account_required" ON public.expense_approvals;
CREATE POLICY "active_account_required"
  ON public.expense_approvals
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.is_active_account())
  WITH CHECK (public.is_active_account());

DROP POLICY IF EXISTS "expense_approvals_select" ON public.expense_approvals;
CREATE POLICY "expense_approvals_select"
  ON public.expense_approvals
  FOR SELECT
  TO authenticated
  USING (public.can_access_expense(auth.uid(), expense_id));

-- Grant SELECT to authenticated; mutations happen via SECURITY DEFINER RPC
REVOKE ALL ON TABLE public.expense_approvals FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.expense_approvals TO authenticated;

-- 4. Update expense_pair_allocations to include ONLY confirmed and active expenses
CREATE OR REPLACE FUNCTION public.expense_pair_allocations(
  p_user_id UUID,
  p_group_id UUID
)
RETURNS TABLE(
  expense_id UUID,
  group_id UUID,
  payer_id UUID,
  participant_id UUID,
  amount_paise BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expense RECORD;
  v_payer_ids UUID[];
  v_payer_amounts BIGINT[];
  v_participant_ids UUID[];
  v_participant_shares BIGINT[];
  v_base BIGINT[][];
  v_remainders NUMERIC[][];
  v_selected BOOLEAN[][];
  v_row_remaining INTEGER[];
  v_column_remaining INTEGER[];
  v_parent INTEGER[];
  v_queue INTEGER[];
  v_node_count INTEGER;
  v_payer_count INTEGER;
  v_participant_count INTEGER;
  v_total_paid BIGINT;
  v_total_shares BIGINT;
  v_row_base BIGINT;
  v_column_base BIGINT;
  v_numerator NUMERIC;
  v_start_row INTEGER;
  v_head INTEGER;
  v_node INTEGER;
  v_candidate INTEGER;
  v_column_node INTEGER;
  v_row_node INTEGER;
  v_previous_column_node INTEGER;
  v_endpoint INTEGER;
  v_i INTEGER;
  v_j INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_expense IN
    SELECT expense.id, expense.group_id, expense.amount_paise
    FROM public.expenses AS expense
    WHERE expense.status IN ('active', 'confirmed')
      AND (p_group_id IS NULL OR expense.group_id = p_group_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.expense_payers AS payer
          WHERE payer.expense_id = expense.id AND payer.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.expense_shares AS share
          WHERE share.expense_id = expense.id AND share.user_id = p_user_id
        )
      )
    ORDER BY expense.id
  LOOP
    SELECT
      pg_catalog.array_agg(payer.user_id ORDER BY payer.user_id),
      pg_catalog.array_agg(payer.amount_paise ORDER BY payer.user_id),
      pg_catalog.sum(payer.amount_paise)
    INTO v_payer_ids, v_payer_amounts, v_total_paid
    FROM public.expense_payers AS payer
    WHERE payer.expense_id = v_expense.id;

    SELECT
      pg_catalog.array_agg(share.user_id ORDER BY share.user_id),
      pg_catalog.array_agg(share.amount_paise ORDER BY share.user_id),
      pg_catalog.sum(share.amount_paise)
    INTO v_participant_ids, v_participant_shares, v_total_shares
    FROM public.expense_shares AS share
    WHERE share.expense_id = v_expense.id;

    IF v_payer_ids IS NULL OR v_participant_ids IS NULL
      OR v_total_paid IS NULL OR v_total_shares IS NULL THEN
      RAISE EXCEPTION 'Active expense % is missing payers or participant shares', v_expense.id
        USING ERRCODE = '23514';
    END IF;

    IF v_total_paid <= 0
      OR v_total_paid <> v_total_shares
      OR v_total_paid <> v_expense.amount_paise THEN
      RAISE EXCEPTION 'Active expense % payer, share, and total amounts do not reconcile', v_expense.id
        USING ERRCODE = '23514';
    END IF;

    v_payer_count := pg_catalog.array_length(v_payer_ids, 1);
    v_participant_count := pg_catalog.array_length(v_participant_ids, 1);
    v_node_count := v_payer_count + v_participant_count;
    v_base := pg_catalog.array_fill(0::BIGINT, ARRAY[v_participant_count, v_payer_count]);
    v_remainders := pg_catalog.array_fill(0::NUMERIC, ARRAY[v_participant_count, v_payer_count]);
    v_selected := pg_catalog.array_fill(FALSE, ARRAY[v_participant_count, v_payer_count]);
    v_row_remaining := pg_catalog.array_fill(0, ARRAY[v_participant_count]);
    v_column_remaining := pg_catalog.array_fill(0, ARRAY[v_payer_count]);

    FOR v_i IN 1..v_participant_count LOOP
      v_row_base := 0;
      FOR v_j IN 1..v_payer_count LOOP
        v_numerator := v_participant_shares[v_i]::NUMERIC * v_payer_amounts[v_j]::NUMERIC;
        v_base[v_i][v_j] := pg_catalog.floor(v_numerator / v_total_paid)::BIGINT;
        v_remainders[v_i][v_j] := pg_catalog.mod(v_numerator, v_total_paid::NUMERIC);
        v_row_base := v_row_base + v_base[v_i][v_j];
      END LOOP;
      v_row_remaining[v_i] := (v_participant_shares[v_i] - v_row_base)::INTEGER;
    END LOOP;

    FOR v_j IN 1..v_payer_count LOOP
      v_column_base := 0;
      FOR v_i IN 1..v_participant_count LOOP
        v_column_base := v_column_base + v_base[v_i][v_j];
      END LOOP;
      v_column_remaining[v_j] := (v_payer_amounts[v_j] - v_column_base)::INTEGER;
    END LOOP;

    FOR v_start_row IN 1..v_participant_count LOOP
      WHILE v_row_remaining[v_start_row] > 0 LOOP
        v_parent := pg_catalog.array_fill(0, ARRAY[v_node_count]);
        v_queue := ARRAY[v_start_row];
        v_parent[v_start_row] := -1;
        v_head := 1;
        v_endpoint := 0;

        WHILE v_head <= pg_catalog.cardinality(v_queue) AND v_endpoint = 0 LOOP
          v_node := v_queue[v_head];
          v_head := v_head + 1;

          IF v_node <= v_participant_count THEN
            FOR v_candidate IN
              SELECT candidate.idx
              FROM pg_catalog.generate_series(1, v_payer_count) AS candidate(idx)
              ORDER BY v_remainders[v_node][candidate.idx] DESC, v_payer_ids[candidate.idx]
            LOOP
              v_column_node := v_participant_count + v_candidate;
              IF v_remainders[v_node][v_candidate] > 0
                AND NOT v_selected[v_node][v_candidate]
                AND v_parent[v_column_node] = 0 THEN
                v_parent[v_column_node] := v_node;
                v_queue := pg_catalog.array_append(v_queue, v_column_node);
                IF v_column_remaining[v_candidate] > 0 THEN
                  v_endpoint := v_column_node;
                  EXIT;
                END IF;
              END IF;
            END LOOP;
          ELSE
            v_j := v_node - v_participant_count;
            FOR v_candidate IN 1..v_participant_count LOOP
              IF v_selected[v_candidate][v_j] AND v_parent[v_candidate] = 0 THEN
                v_parent[v_candidate] := v_node;
                v_queue := pg_catalog.array_append(v_queue, v_candidate);
              END IF;
            END LOOP;
          END IF;
        END LOOP;

        IF v_endpoint = 0 THEN
          RAISE EXCEPTION 'Could not reconcile integer-paise allocation for expense %', v_expense.id
            USING ERRCODE = '23514';
        END IF;

        v_column_node := v_endpoint;
        LOOP
          v_row_node := v_parent[v_column_node];
          v_j := v_column_node - v_participant_count;
          v_selected[v_row_node][v_j] := TRUE;
          IF v_row_node = v_start_row THEN
            EXIT;
          END IF;
          v_previous_column_node := v_parent[v_row_node];
          v_selected[v_row_node][v_previous_column_node - v_participant_count] := FALSE;
          v_column_node := v_previous_column_node;
        END LOOP;

        v_row_remaining[v_start_row] := v_row_remaining[v_start_row] - 1;
        v_column_remaining[v_endpoint - v_participant_count]
          := v_column_remaining[v_endpoint - v_participant_count] - 1;
      END LOOP;
    END LOOP;

    FOR v_j IN 1..v_payer_count LOOP
      IF v_column_remaining[v_j] <> 0 THEN
        RAISE EXCEPTION 'Could not reconcile payer totals for expense %', v_expense.id
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    FOR v_i IN 1..v_participant_count LOOP
      FOR v_j IN 1..v_payer_count LOOP
        expense_id := v_expense.id;
        group_id := v_expense.group_id;
        payer_id := v_payer_ids[v_j];
        participant_id := v_participant_ids[v_i];
        amount_paise := v_base[v_i][v_j] + CASE WHEN v_selected[v_i][v_j] THEN 1 ELSE 0 END;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

-- 5. RPC to respond to expense approval (Approve or Dispute)
CREATE OR REPLACE FUNCTION public.respond_to_expense_approval(
  p_expense_id UUID,
  p_action TEXT,
  p_dispute_reason TEXT DEFAULT NULL,
  p_dispute_category TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_approval public.expense_approvals%ROWTYPE;
  v_expense public.expenses%ROWTYPE;
  v_all_approved BOOLEAN := FALSE;
  v_new_status public.expense_status;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('approve', 'dispute') THEN
    RAISE EXCEPTION 'Invalid approval action. Must be approve or dispute' USING ERRCODE = '22023';
  END IF;

  -- Acquire advisory lock on expense to serialize concurrent approvals
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expense_id::TEXT, 0));

  -- Lock approval row for update
  SELECT * INTO v_approval
  FROM public.expense_approvals
  WHERE expense_id = p_expense_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a required participant for this expense approval'
      USING ERRCODE = '42501';
  END IF;

  -- Lock outer expense row for update
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status IN ('deleted', 'voided', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot approve or dispute an inactive or deleted expense'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.expense_approvals
    SET
      status = 'approved',
      dispute_reason = NULL,
      dispute_category = NULL,
      responded_at = NOW(),
      updated_at = NOW()
    WHERE id = v_approval.id;

    -- Check if all participant approvals are now approved
    SELECT NOT EXISTS (
      SELECT 1 FROM public.expense_approvals
      WHERE expense_id = p_expense_id AND status <> 'approved'
    ) INTO v_all_approved;

    IF v_all_approved THEN
      v_new_status := 'confirmed';
      UPDATE public.expenses
      SET status = 'confirmed', updated_at = NOW()
      WHERE id = p_expense_id;
    ELSE
      v_new_status := 'pending_approval';
      UPDATE public.expenses
      SET status = 'pending_approval', updated_at = NOW()
      WHERE id = p_expense_id;
    END IF;

  ELSIF p_action = 'dispute' THEN
    UPDATE public.expense_approvals
    SET
      status = 'disputed',
      dispute_reason = NULLIF(pg_catalog.btrim(p_dispute_reason), ''),
      dispute_category = NULLIF(pg_catalog.btrim(p_dispute_category), ''),
      responded_at = NOW(),
      updated_at = NOW()
    WHERE id = v_approval.id;

    v_new_status := 'disputed';
    UPDATE public.expenses
    SET status = 'disputed', updated_at = NOW()
    WHERE id = p_expense_id;
  END IF;

  -- Audit log in expense_history
  INSERT INTO public.expense_history (
    expense_id, changed_by, change_type, previous_data, new_data, changed_at
  ) VALUES (
    p_expense_id,
    v_user_id,
    'approval_' || p_action,
    pg_catalog.jsonb_build_object(
      'previous_approval_status', v_approval.status,
      'previous_expense_status', v_expense.status
    ),
    pg_catalog.jsonb_build_object(
      'new_approval_status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'disputed' END,
      'new_expense_status', v_new_status,
      'dispute_reason', p_dispute_reason,
      'dispute_category', p_dispute_category
    ),
    NOW()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'expense_id', p_expense_id,
    'action', p_action,
    'expense_status', v_new_status,
    'all_approved', v_all_approved
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.respond_to_expense_approval(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_expense_approval(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 6. Update create_expense_with_records to seed participant approvals
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
  v_other_participant_count BIGINT;
  v_initial_status public.expense_status;
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
    COALESCE(pg_catalog.sum(share."amountPaise"), 0),
    COALESCE(pg_catalog.count(CASE WHEN share."userId" <> v_creator_id THEN 1 END), 0)
  INTO v_share_count, v_share_user_count, v_share_distinct_user_count, v_share_amount_count, v_share_total, v_other_participant_count
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

  -- Determine initial status: if other participants exist, pending_approval; if creator is sole participant, confirmed
  IF v_other_participant_count > 0 THEN
    v_initial_status := 'pending_approval'::public.expense_status;
  ELSE
    v_initial_status := 'confirmed'::public.expense_status;
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
    v_expense_id := v_expense.id;
  ELSE
    INSERT INTO public.expenses (
      title, amount_paise, currency, split_method, group_id, creator_id,
      expense_date, category, notes, idempotency_key, status
    )
    VALUES (
      v_title, v_amount_paise, v_currency, v_split_method, v_group_id, v_creator_id,
      v_expense_date, v_category, v_notes, v_idempotency_key, v_initial_status
    )
    RETURNING id INTO v_expense_id;
  END IF;

  -- Insert payers
  INSERT INTO public.expense_payers (expense_id, user_id, amount_paise)
  SELECT v_expense_id, expected."userId", expected."amountPaise"
  FROM pg_catalog.jsonb_to_recordset(p_payers) AS expected("userId" UUID, "amountPaise" BIGINT)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_payers AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  -- Insert shares
  INSERT INTO public.expense_shares (expense_id, user_id, amount_paise, percentage, share_weight)
  SELECT
    v_expense_id,
    expected."userId",
    expected."amountPaise",
    expected.percentage,
    expected.share_weight
  FROM pg_catalog.jsonb_to_recordset(p_shares) AS expected(
    "userId" UUID,
    "amountPaise" BIGINT,
    percentage NUMERIC,
    share_weight NUMERIC
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_shares AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  -- Seed required participant approvals (every participant except creator)
  INSERT INTO public.expense_approvals (expense_id, user_id, status)
  SELECT v_expense_id, expected."userId", 'pending'
  FROM pg_catalog.jsonb_to_recordset(p_shares) AS expected("userId" UUID)
  WHERE expected."userId" <> v_creator_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.expense_approvals AS existing
      WHERE existing.expense_id = v_expense_id
        AND existing.user_id = expected."userId"
    );

  RETURN v_expense_id;
END;
$function$;

-- 7. Update update_expense_with_records to invalidate participant approvals on material edits
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
  v_other_participant_count BIGINT;
  v_pair_key TEXT;
  v_new_status public.expense_status;
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

  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;

  IF v_expense.status IN ('deleted', 'voided', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot edit an inactive or deleted expense' USING ERRCODE = '22023';
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

  SELECT
    pg_catalog.count(*),
    COALESCE(pg_catalog.sum(share.amount_paise), 0),
    COALESCE(pg_catalog.count(CASE WHEN share.user_id <> v_expense.creator_id THEN 1 END), 0)
  INTO v_share_count, v_share_total, v_other_participant_count
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

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expense_id::TEXT, 0));

  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;

  IF v_expense.status IN ('deleted', 'voided', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot edit an inactive or deleted expense' USING ERRCODE = '22023';
  END IF;

  IF v_expense.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Expense changed since it was opened; reload and retry'
      USING ERRCODE = '40001';
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

  -- Invalidate prior approvals on material edits: reset approvals to pending
  IF v_other_participant_count > 0 THEN
    v_new_status := 'pending_approval'::public.expense_status;

    -- Ensure approval rows exist and are reset to pending for all non-creator participants
    INSERT INTO public.expense_approvals (expense_id, user_id, status)
    SELECT p_expense_id, share.user_id, 'pending'
    FROM public.expense_shares AS share
    WHERE share.expense_id = p_expense_id
      AND share.user_id <> v_expense.creator_id
    ON CONFLICT (expense_id, user_id) DO UPDATE
    SET status = 'pending',
        dispute_reason = NULL,
        dispute_category = NULL,
        responded_at = NULL,
        updated_at = NOW();
  ELSE
    v_new_status := 'confirmed'::public.expense_status;
  END IF;

  UPDATE public.expenses AS expense
  SET title = pg_catalog.btrim(p_title),
      amount_paise = p_amount_paise,
      expense_date = p_expense_date,
      notes = NULLIF(pg_catalog.btrim(p_notes), ''),
      category = NULLIF(pg_catalog.btrim(p_category), ''),
      status = v_new_status,
      updated_at = NOW()
  WHERE expense.id = p_expense_id;

  INSERT INTO public.expense_history (
    expense_id, changed_by, change_type, previous_data, new_data, changed_at
  ) VALUES (
    p_expense_id,
    v_user_id,
    'update_with_approval_invalidation',
    pg_catalog.jsonb_build_object(
      'previous_amount_paise', v_expense.amount_paise,
      'previous_title', v_expense.title,
      'previous_status', v_expense.status
    ),
    pg_catalog.jsonb_build_object(
      'new_amount_paise', p_amount_paise,
      'new_title', p_title,
      'new_status', v_new_status
    ),
    NOW()
  );

  RETURN p_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) TO authenticated;

-- 8. Historical expense status conversion and participant approval backfill
UPDATE public.expenses
SET status = 'confirmed'
WHERE status = 'active';

INSERT INTO public.expense_approvals (expense_id, user_id, status, responded_at)
SELECT share.expense_id, share.user_id, 'approved', e.created_at
FROM public.expense_shares share
JOIN public.expenses e ON e.id = share.expense_id
WHERE e.status = 'confirmed'
  AND share.user_id <> e.creator_id
ON CONFLICT (expense_id, user_id) DO NOTHING;

-- 9. Update delete_expense to clean up expense_approvals on soft-delete
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
    JOIN public.expense_shares AS share ON (share.expense_id = p_expense_id)
    WHERE s.status IN ('proposed', 'pending')
      AND p.user_id <> share.user_id
      AND (
        (s.payer_id = share.user_id AND s.recipient_id = p.user_id) OR
        (s.payer_id = p.user_id AND s.recipient_id = share.user_id)
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
  DELETE FROM public.expense_approvals WHERE expense_id = p_expense_id;

  RETURN p_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_expense(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;

COMMIT;
