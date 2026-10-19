-- Migration 003: Server-side functions for secure operations
-- These functions run with SECURITY DEFINER to enforce server-side logic

-- ============================================================
-- accept_invitation RPC
-- Called by authenticated user to accept a friend or group invitation
-- ============================================================
CREATE OR REPLACE FUNCTION accept_invitation(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_record invitation_tokens%ROWTYPE;
  v_caller_id UUID;
  v_result JSONB;
BEGIN
  -- Get caller identity
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up token
  SELECT * INTO v_token_record
  FROM invitation_tokens
  WHERE token = p_token
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
    AND use_count < max_uses
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid, expired, or exhausted invitation token');
  END IF;

  -- Prevent creator from using their own invitation
  IF v_token_record.creator_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'Cannot use your own invitation');
  END IF;

  -- Handle friend invitation
  IF v_token_record.type = 'friend' THEN
    -- Check if already friends or request exists
    IF EXISTS (
      SELECT 1 FROM friend_requests
      WHERE ((sender_id = v_token_record.creator_id AND receiver_id = v_caller_id)
          OR (sender_id = v_caller_id AND receiver_id = v_token_record.creator_id))
        AND status = 'accepted'
    ) THEN
      RETURN jsonb_build_object('error', 'Already friends');
    END IF;

    -- Upsert friend relationship: insert accepted request
    INSERT INTO friend_requests (sender_id, receiver_id, status)
    VALUES (v_token_record.creator_id, v_caller_id, 'accepted')
    ON CONFLICT (sender_id, receiver_id) DO UPDATE
      SET status = 'accepted', updated_at = NOW();

    -- Increment use count
    UPDATE invitation_tokens
    SET use_count = use_count + 1
    WHERE id = v_token_record.id;

    v_result := jsonb_build_object(
      'success', true,
      'type', 'friend',
      'friendId', v_token_record.creator_id
    );

  -- Handle group invitation
  ELSIF v_token_record.type = 'group' THEN
    IF v_token_record.target_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Invalid group invitation: no group specified');
    END IF;

    -- Check if already a member
    IF EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = v_token_record.target_id
        AND user_id = v_caller_id
        AND removed_at IS NULL
    ) THEN
      RETURN jsonb_build_object('error', 'Already a member of this group');
    END IF;

    -- Add as member
    INSERT INTO group_members (group_id, user_id, role, invited_by)
    VALUES (v_token_record.target_id, v_caller_id, 'member', v_token_record.creator_id)
    ON CONFLICT (group_id, user_id) DO UPDATE
      SET removed_at = NULL, role = 'member', invited_by = v_token_record.creator_id;

    -- Increment use count
    UPDATE invitation_tokens
    SET use_count = use_count + 1
    WHERE id = v_token_record.id;

    v_result := jsonb_build_object(
      'success', true,
      'type', 'group',
      'groupId', v_token_record.target_id
    );

  ELSE
    RETURN jsonb_build_object('error', 'Unknown invitation type');
  END IF;

  RETURN v_result;
END;
$$;

-- Revoke EXECUTE from public, grant only to authenticated users
REVOKE EXECUTE ON FUNCTION accept_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invitation(TEXT) TO authenticated;

-- ============================================================
-- get_friend_balances: compute net balances between the caller
-- and all friends, considering shared expenses + settlements.
-- ============================================================
CREATE OR REPLACE FUNCTION get_friend_balances()
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller AS (SELECT auth.uid() AS uid),
  -- What caller paid and others owe caller
  payer_credits AS (
    SELECT
      es.user_id AS other_user,
      es.amount_paise AS credit_paise
    FROM expense_shares es
    JOIN expense_payers ep ON ep.expense_id = es.expense_id AND ep.user_id = (SELECT uid FROM caller)
    JOIN expenses e ON e.id = es.expense_id AND e.status = 'active'
    WHERE es.user_id != (SELECT uid FROM caller)
  ),
  -- What caller owes others who paid
  debtor_charges AS (
    SELECT
      ep.user_id AS other_user,
      es.amount_paise AS charge_paise
    FROM expense_shares es
    JOIN expense_payers ep ON ep.expense_id = es.expense_id AND ep.user_id != (SELECT uid FROM caller)
    JOIN expenses e ON e.id = es.expense_id AND e.status = 'active'
    WHERE es.user_id = (SELECT uid FROM caller)
  ),
  -- Confirmed settlements where caller paid
  caller_paid_settlements AS (
    SELECT recipient_id AS other_user, amount_paise
    FROM settlements
    WHERE payer_id = (SELECT uid FROM caller) AND status = 'confirmed'
  ),
  -- Confirmed settlements where caller received
  caller_received_settlements AS (
    SELECT payer_id AS other_user, amount_paise
    FROM settlements
    WHERE recipient_id = (SELECT uid FROM caller) AND status = 'confirmed'
  ),
  combined AS (
    SELECT other_user, credit_paise AS net FROM payer_credits
    UNION ALL
    SELECT other_user, -charge_paise FROM debtor_charges
    UNION ALL
    SELECT other_user, -amount_paise FROM caller_paid_settlements
    UNION ALL
    SELECT other_user, amount_paise FROM caller_received_settlements
  ),
  aggregated AS (
    SELECT
      other_user,
      SUM(net)::BIGINT AS net_paise
    FROM combined
    GROUP BY other_user
    HAVING SUM(net) != 0
  )
  SELECT
    other_user AS other_user_id,
    net_paise,
    GREATEST(net_paise, 0)::BIGINT AS owed_to_paise,
    GREATEST(-net_paise, 0)::BIGINT AS owing_paise
  FROM aggregated;
$$;

REVOKE EXECUTE ON FUNCTION get_friend_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_friend_balances() TO authenticated;
