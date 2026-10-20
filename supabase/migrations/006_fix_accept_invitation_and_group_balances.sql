-- Migration 006: Fix accept_invitation ON CONFLICT and add get_group_balances
--
-- Bug fixed:
--   The `accept_invitation` function used ON CONFLICT (sender_id, receiver_id) which
--   does NOT match the actual unique index `idx_unique_friendship` which is defined as:
--     UNIQUE (LEAST(sender_id::text, receiver_id::text), GREATEST(sender_id::text, receiver_id::text))
--   As a result, when a friend_requests row exists in the reverse direction
--   (receiver_id=creator, sender_id=caller), the INSERT would succeed and create a
--   duplicate row violating uniqueness — or fail unexpectedly with a unique violation
--   error that is not handled.
--
-- Fix: replace ON CONFLICT with explicit SELECT + INSERT/UPDATE logic.
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
  v_token_record  invitation_tokens%ROWTYPE;
  v_caller_id     UUID;
  v_existing_req  friend_requests%ROWTYPE;
  v_result        JSONB;
BEGIN
  -- Identify caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock and fetch token (prevents concurrent double-use)
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

  -- Prevent self-use
  IF v_token_record.creator_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'Cannot use your own invitation');
  END IF;

  -- ── Friend invitation ──────────────────────────────────────────────────────
  IF v_token_record.type = 'friend' THEN

    -- Look for any existing friendship record regardless of direction
    SELECT * INTO v_existing_req
    FROM friend_requests
    WHERE (
      (sender_id = v_token_record.creator_id AND receiver_id = v_caller_id)
      OR
      (sender_id = v_caller_id AND receiver_id = v_token_record.creator_id)
    )
    LIMIT 1;

    IF FOUND THEN
      IF v_existing_req.status = 'accepted' THEN
        RETURN jsonb_build_object('error', 'Already friends');
      END IF;
      -- Update existing row to accepted (handles pending, rejected, cancelled)
      UPDATE friend_requests
      SET status = 'accepted', updated_at = NOW()
      WHERE id = v_existing_req.id;
    ELSE
      -- Insert new accepted friendship record
      INSERT INTO friend_requests (sender_id, receiver_id, status)
      VALUES (v_token_record.creator_id, v_caller_id, 'accepted');
    END IF;

    -- Increment token use count
    UPDATE invitation_tokens
    SET use_count = use_count + 1
    WHERE id = v_token_record.id;

    v_result := jsonb_build_object(
      'success', true,
      'type', 'friend',
      'friendId', v_token_record.creator_id
    );

  -- ── Group invitation ────────────────────────────────────────────────────────
  ELSIF v_token_record.type = 'group' THEN
    IF v_token_record.target_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Invalid group invitation: no group specified');
    END IF;

    IF EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = v_token_record.target_id
        AND user_id = v_caller_id
        AND removed_at IS NULL
    ) THEN
      RETURN jsonb_build_object('error', 'Already a member of this group');
    END IF;

    -- Add or re-add member (handles previously removed members)
    INSERT INTO group_members (group_id, user_id, role, invited_by)
    VALUES (v_token_record.target_id, v_caller_id, 'member', v_token_record.creator_id)
    ON CONFLICT (group_id, user_id) DO UPDATE
      SET removed_at = NULL,
          role       = 'member',
          invited_by = v_token_record.creator_id;

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

REVOKE EXECUTE ON FUNCTION accept_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invitation(TEXT) TO authenticated;


-- ============================================================
-- get_group_balances: compute per-member net balances within a
-- specific group for the calling user.
--
-- Returns one row per other_user_id where there is a non-zero
-- balance arising from group expenses and confirmed settlements
-- that reference any group expense.
--
-- net_paise > 0 → other_user owes the caller (within this group)
-- net_paise < 0 → caller owes other_user (within this group)
-- ============================================================
CREATE OR REPLACE FUNCTION get_group_balances(p_group_id UUID)
RETURNS TABLE (
  other_user_id UUID,
  net_paise     BIGINT,
  owed_to_paise BIGINT,
  owing_paise   BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller AS (SELECT auth.uid() AS uid),

  -- Per-(payer, participant) ledger for active expenses in this group
  expense_ledger AS (
    SELECT
      ep.user_id                                         AS payer_id,
      es.user_id                                         AS participant_id,
      ROUND(
        es.amount_paise::NUMERIC
        * ep.amount_paise::NUMERIC
        / e.amount_paise::NUMERIC
      )::BIGINT                                          AS credit_paise
    FROM expenses e
    JOIN expense_payers ep ON ep.expense_id = e.id
    JOIN expense_shares es ON es.expense_id = e.id
    WHERE e.status    = 'active'
      AND e.group_id  = p_group_id
      AND ep.user_id <> es.user_id
  ),

  caller_as_payer AS (
    SELECT participant_id AS other_user, credit_paise AS net
    FROM expense_ledger
    WHERE payer_id = (SELECT uid FROM caller)
  ),

  caller_as_participant AS (
    SELECT payer_id AS other_user, -credit_paise AS net
    FROM expense_ledger
    WHERE participant_id = (SELECT uid FROM caller)
  ),

  -- Confirmed settlements that settle debts created within this group.
  -- We attribute a settlement to the group when the settlement's
  -- expense context is this group (best-effort: filter settlements
  -- where the payer/recipient pair has a balance in this group).
  caller_paid AS (
    SELECT s.recipient_id AS other_user, s.amount_paise AS net
    FROM settlements s
    WHERE s.payer_id = (SELECT uid FROM caller)
      AND s.status   = 'confirmed'
      AND s.group_id = p_group_id
  ),

  caller_received AS (
    SELECT s.payer_id AS other_user, -s.amount_paise AS net
    FROM settlements s
    WHERE s.recipient_id = (SELECT uid FROM caller)
      AND s.status       = 'confirmed'
      AND s.group_id     = p_group_id
  ),

  all_flows AS (
    SELECT other_user, net FROM caller_as_payer
    UNION ALL
    SELECT other_user, net FROM caller_as_participant
    UNION ALL
    SELECT other_user, net FROM caller_paid
    UNION ALL
    SELECT other_user, net FROM caller_received
  ),

  aggregated AS (
    SELECT
      other_user,
      SUM(net)::BIGINT AS net_paise
    FROM all_flows
    GROUP BY other_user
    HAVING ABS(SUM(net)) >= 1
  )

  SELECT
    other_user              AS other_user_id,
    net_paise,
    GREATEST(net_paise, 0)::BIGINT  AS owed_to_paise,
    GREATEST(-net_paise, 0)::BIGINT AS owing_paise
  FROM aggregated;
$$;

REVOKE EXECUTE ON FUNCTION get_group_balances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_group_balances(UUID) TO authenticated;
