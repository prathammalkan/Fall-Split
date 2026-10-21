-- Keep settlement creation and confirmation atomic and bound to current debt.
-- Confirmed settlements are permanent ledger records; users can only transition
-- a proposed settlement through the RPCs below.

DROP POLICY IF EXISTS "settlements_payer_insert" ON public.settlements;
DROP POLICY IF EXISTS "settlements_parties_update" ON public.settlements;

CREATE OR REPLACE FUNCTION public.prevent_settlement_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Settlement history cannot be deleted';
  END IF;

  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'Confirmed settlements are immutable';
  END IF;

  IF ROW(
    NEW.payer_id, NEW.recipient_id, NEW.amount_paise, NEW.currency,
    NEW.group_id, NEW.idempotency_key, NEW.proposed_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.payer_id, OLD.recipient_id, OLD.amount_paise, OLD.currency,
    OLD.group_id, OLD.idempotency_key, OLD.proposed_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Settlement details cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (
      OLD.status IN ('proposed', 'pending')
      AND NEW.status IN ('confirmed', 'rejected', 'cancelled')
    )
  THEN
    RAISE EXCEPTION 'Invalid settlement status transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER settlement_history_immutable
  BEFORE UPDATE OR DELETE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_settlement_history_mutation();

CREATE OR REPLACE FUNCTION public.propose_settlement(
  p_recipient_id UUID,
  p_amount_paise BIGINT,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payer_id UUID := auth.uid();
  v_net_paise BIGINT;
  v_settlement_id UUID;
  v_existing public.settlements%ROWTYPE;
BEGIN
  IF v_payer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_payer_id THEN
    RAISE EXCEPTION 'Invalid settlement recipient' USING ERRCODE = '22023';
  END IF;
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'Settlement amount must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.settlements
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payer_id = v_payer_id
      AND v_existing.recipient_id = p_recipient_id
      AND v_existing.amount_paise = p_amount_paise THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Idempotency key was already used for another settlement'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    LEAST(v_payer_id::TEXT, p_recipient_id::TEXT) || ':' ||
    GREATEST(v_payer_id::TEXT, p_recipient_id::TEXT), 0
  ));

  SELECT * INTO v_existing
  FROM public.settlements
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payer_id = v_payer_id
      AND v_existing.recipient_id = p_recipient_id
      AND v_existing.amount_paise = p_amount_paise THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Idempotency key was already used for another settlement'
      USING ERRCODE = '22023';
  END IF;

  SELECT net_paise INTO v_net_paise
  FROM public.get_friend_balances()
  WHERE other_user_id = p_recipient_id;

  IF COALESCE(v_net_paise, 0) >= 0 OR p_amount_paise > -v_net_paise THEN
    RAISE EXCEPTION 'Settlement amount exceeds the outstanding debt'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.settlements (
    payer_id, recipient_id, amount_paise, currency, idempotency_key, status
  )
  VALUES (
    v_payer_id, p_recipient_id, p_amount_paise, 'INR', p_idempotency_key, 'proposed'
  )
  RETURNING id INTO v_settlement_id;

  RETURN v_settlement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_settlement(
  p_settlement_id UUID,
  p_action TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_settlement public.settlements%ROWTYPE;
  v_net_paise BIGINT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN
    RAISE EXCEPTION 'Invalid settlement action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settlement
  FROM public.settlements
  WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    LEAST(v_settlement.payer_id::TEXT, v_settlement.recipient_id::TEXT) || ':' ||
    GREATEST(v_settlement.payer_id::TEXT, v_settlement.recipient_id::TEXT), 0
  ));

  SELECT * INTO v_settlement
  FROM public.settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF v_settlement.recipient_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the recipient can respond to this settlement'
      USING ERRCODE = '42501';
  END IF;
  IF v_settlement.status NOT IN ('proposed', 'pending') THEN
    RAISE EXCEPTION 'Settlement is no longer awaiting confirmation'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'confirm' THEN
    SELECT net_paise INTO v_net_paise
    FROM public.get_friend_balances()
    WHERE other_user_id = v_settlement.payer_id;

    IF COALESCE(v_net_paise, 0) < v_settlement.amount_paise THEN
      RAISE EXCEPTION 'Settlement exceeds the remaining outstanding debt'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.settlements
    SET status = 'confirmed', confirmed_at = NOW()
    WHERE id = p_settlement_id;
  ELSE
    UPDATE public.settlements
    SET status = 'rejected', rejected_at = NOW()
    WHERE id = p_settlement_id;
  END IF;

  RETURN p_settlement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_settlement(p_settlement_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_settlement public.settlements%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settlement
  FROM public.settlements
  WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    LEAST(v_settlement.payer_id::TEXT, v_settlement.recipient_id::TEXT) || ':' ||
    GREATEST(v_settlement.payer_id::TEXT, v_settlement.recipient_id::TEXT), 0
  ));

  SELECT * INTO v_settlement
  FROM public.settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF v_settlement.payer_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the payer can cancel this settlement'
      USING ERRCODE = '42501';
  END IF;
  IF v_settlement.status NOT IN ('proposed', 'pending') THEN
    RAISE EXCEPTION 'Settlement is no longer cancellable'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.settlements
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = p_settlement_id;

  RETURN p_settlement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_to_settlement(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_settlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_settlement(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_settlement(UUID) TO authenticated;
