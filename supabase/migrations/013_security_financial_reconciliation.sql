-- Forward-only reconciliation for audited Fall Split environments.
-- Do not mark migrations 001-012 as applied based on object presence alone:
-- no repository migration ledger was found during the read-only audit.

-- A member may leave only through this narrow operation; the direct UPDATE
-- policy allowed the member to change their own role before this migration.
DROP POLICY IF EXISTS "group_members_self_leave" ON public.group_members;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.group_members
  SET removed_at = pg_catalog.now()
  WHERE group_id = p_group_id
    AND user_id = v_user_id
    AND removed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active group membership not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated;

-- Replace broad profile row access with a public-safe discoverability view and
-- a caller-bound RPC for own/friend profile details.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (id, username, display_name, avatar_url, bio, upi_id, created_at, updated_at, deleted_at)
  ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (id, username, display_name, avatar_url, bio, upi_id, created_at, updated_at, deleted_at)
  ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, display_name, avatar_url)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username, display_name, bio, upi_id)
  ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE VIEW public.discoverable_profiles
WITH (security_invoker = true)
AS
  SELECT id, username, display_name, avatar_url
  FROM public.profiles;

GRANT SELECT ON public.discoverable_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_for_user(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  upi_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    profile.id,
    profile.username,
    profile.display_name,
    profile.avatar_url,
    profile.bio,
    profile.upi_id,
    profile.created_at,
    profile.updated_at,
    profile.deleted_at
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.deleted_at IS NULL
    AND auth.uid() IS NOT NULL
    AND (
      profile.id = auth.uid()
      OR public.are_friends(auth.uid(), profile.id)
    );
$function$;

REVOKE ALL ON FUNCTION public.get_profile_for_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_settlement_recipient_upis()
RETURNS TABLE (settlement_id UUID, upi_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT settlement.id, profile.upi_id
  FROM public.settlements AS settlement
  JOIN public.profiles AS profile ON profile.id = settlement.recipient_id
  WHERE settlement.payer_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND settlement.status IN ('proposed', 'pending')
    AND profile.deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settlement_recipient_upis() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    deleted_at = pg_catalog.now(),
    display_name = '[Deleted User]',
    username = 'deleted_' || pg_catalog.substring(v_user_id::TEXT, 1, 8),
    avatar_url = NULL,
    bio = NULL,
    upi_id = NULL,
    updated_at = pg_catalog.now()
  WHERE id = v_user_id
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Account profile not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.group_members
  SET removed_at = pg_catalog.now()
  WHERE user_id = v_user_id
    AND removed_at IS NULL;

  UPDATE public.friend_requests
  SET status = 'cancelled', updated_at = pg_catalog.now()
  WHERE (sender_id = v_user_id OR receiver_id = v_user_id)
    AND status = 'pending';

  UPDATE public.invitation_tokens
  SET revoked_at = pg_catalog.now()
  WHERE creator_id = v_user_id
    AND revoked_at IS NULL;

  UPDATE public.settlements
  SET status = 'cancelled', cancelled_at = pg_catalog.now()
  WHERE payer_id = v_user_id
    AND status IN ('proposed', 'pending');

  RETURN pg_catalog.json_build_object('success', TRUE);
END;
$function$;

-- Allocate proportional integer-paise shares with controlled rounding. The
-- augmenting-path pass preserves both participant totals and payer totals.
CREATE OR REPLACE FUNCTION public.expense_pair_allocations(p_user_id UUID, p_group_id UUID)
RETURNS TABLE (
  expense_id UUID,
  group_id UUID,
  payer_id UUID,
  participant_id UUID,
  amount_paise BIGINT
)
LANGUAGE plpgsql
STABLE
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
    WHERE expense.status = 'active'
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

    -- Find a deterministic augmenting path for each residual paise. This
    -- controlled rounding preserves both participant-share and payer totals.
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

REVOKE ALL ON FUNCTION public.expense_pair_allocations(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_friend_balances()
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH caller AS (SELECT auth.uid() AS uid),
  allocations AS MATERIALIZED (
    SELECT allocation.*
    FROM public.expense_pair_allocations((SELECT uid FROM caller), NULL::UUID) AS allocation
  ),
  flows AS (
    SELECT
      allocation.participant_id AS other_user,
      allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.payer_id = (SELECT uid FROM caller)
      AND allocation.participant_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT
      allocation.payer_id AS other_user,
      -allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.participant_id = (SELECT uid FROM caller)
      AND allocation.payer_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT settlement.recipient_id, settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.payer_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'

    UNION ALL

    SELECT settlement.payer_id, -settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.recipient_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
  ),
  aggregated AS (
    SELECT flow.other_user, pg_catalog.sum(flow.net)::BIGINT AS balance
    FROM flows AS flow
    WHERE flow.other_user IS NOT NULL
    GROUP BY flow.other_user
    HAVING pg_catalog.sum(flow.net) <> 0
  )
  SELECT
    aggregate.other_user,
    aggregate.balance,
    CASE WHEN aggregate.balance > 0 THEN aggregate.balance ELSE 0 END::BIGINT,
    CASE WHEN aggregate.balance < 0 THEN -aggregate.balance ELSE 0 END::BIGINT
  FROM aggregated AS aggregate;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_balances(p_group_id UUID)
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH caller AS (
    SELECT auth.uid() AS uid
    WHERE auth.uid() IS NOT NULL
      AND public.is_group_member(auth.uid(), p_group_id)
  ),
  allocations AS MATERIALIZED (
    SELECT allocation.*
    FROM public.expense_pair_allocations((SELECT uid FROM caller), p_group_id) AS allocation
  ),
  flows AS (
    SELECT
      allocation.participant_id AS other_user,
      allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.group_id = p_group_id
      AND allocation.payer_id = (SELECT uid FROM caller)
      AND allocation.participant_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT
      allocation.payer_id AS other_user,
      -allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.group_id = p_group_id
      AND allocation.participant_id = (SELECT uid FROM caller)
      AND allocation.payer_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT settlement.recipient_id, settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.payer_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
      AND settlement.group_id = p_group_id

    UNION ALL

    SELECT settlement.payer_id, -settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.recipient_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
      AND settlement.group_id = p_group_id
  ),
  aggregated AS (
    SELECT flow.other_user, pg_catalog.sum(flow.net)::BIGINT AS balance
    FROM flows AS flow
    WHERE flow.other_user IS NOT NULL
    GROUP BY flow.other_user
    HAVING pg_catalog.sum(flow.net) <> 0
  )
  SELECT
    aggregate.other_user,
    aggregate.balance,
    CASE WHEN aggregate.balance > 0 THEN aggregate.balance ELSE 0 END::BIGINT,
    CASE WHEN aggregate.balance < 0 THEN -aggregate.balance ELSE 0 END::BIGINT
  FROM aggregated AS aggregate;
$function$;

-- Internal helper/access RPCs are not directly exposed to anonymous callers.
-- Invitation preview is deliberately public and returns only approved fields.
-- Bind relationship/access helper IDs to the caller so the interval before
-- migration 014 cannot be used as an arbitrary-ID relationship probe.
CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND user_a = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.friend_requests AS request
      WHERE request.status = 'accepted'
        AND LEAST(request.sender_id, request.receiver_id) = LEAST(user_a, user_b)
        AND GREATEST(request.sender_id, request.receiver_id) = GREATEST(user_a, user_b)
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_member(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_members AS member
      WHERE member.user_id = p_user_id
        AND member.group_id = p_group_id
        AND member.removed_at IS NULL
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.group_members AS member
      WHERE member.user_id = p_user_id
        AND member.group_id = p_group_id
        AND member.role = 'admin'
        AND member.removed_at IS NULL
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_expense(p_user_id UUID, p_expense_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.expenses AS expense
      WHERE expense.id = p_expense_id
        AND expense.status <> 'deleted'
        AND (
          expense.creator_id = p_user_id
          OR EXISTS (
            SELECT 1
            FROM public.expense_payers AS payer
            WHERE payer.expense_id = expense.id
              AND payer.user_id = p_user_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.expense_shares AS share
            WHERE share.expense_id = expense.id
              AND share.user_id = p_user_id
          )
          OR (
            expense.group_id IS NOT NULL
            AND public.is_group_member(p_user_id, expense.group_id)
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_group_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_group_admin(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_expense(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_friend_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_group_balances(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_account() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_settlement(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_settlement(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_expense(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_balances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settlement_recipient_upis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_settlement(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_settlement(UUID) TO authenticated;

ALTER FUNCTION public.are_friends(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.is_group_member(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.is_group_admin(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.can_access_expense(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.accept_invitation(TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_invitation_preview(TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.delete_account() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.respond_to_settlement(UUID, TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cancel_settlement(UUID) SET search_path = pg_catalog, public, pg_temp;
