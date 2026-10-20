-- Migration 005: Fix get_friend_balances for correct multi-payer expense handling
--
-- Root cause of previous bug in the original get_friend_balances:
-- The payer_credits CTE credited ALL other participants' shares to the caller
-- whenever caller was a payer — this overcounts when there are multiple payers.
-- Similarly, debtor_charges charged the caller's full share for EACH payer,
-- producing double-charges in multi-payer scenarios.
--
-- Correct model for multi-payer expenses:
-- For each (payer, participant) pair in an expense:
--   payer is owed: participant_share * (payer_contribution / expense_total)
-- This is proportional to how much of the expense each payer covered.
--
-- Example: ₹100 expense, Payers: A=₹60, B=₹40. Participants: A=₹40, B=₹35, C=₹25.
--   A→B credit: 35 * 60/100 = ₹21    A→C credit: 25 * 60/100 = ₹15
--   B→A credit: 40 * 40/100 = ₹16    B→C credit: 25 * 40/100 = ₹10
-- Net A↔B: A owed ₹21, owes ₹16, net A is owed ₹5 by B.
-- Total paid by A (₹60) - A's share (₹40) = net credit ₹20, split proportionally.

CREATE OR REPLACE FUNCTION get_friend_balances()
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

  -- Per-(payer, participant) ledger entries for active expenses.
  -- credit_paise = how much the participant owes the payer for this expense.
  -- Uses proportional split: payer's fraction of total × participant's share.
  -- This correctly handles any number of payers per expense.
  expense_ledger AS (
    SELECT
      ep.user_id                                            AS payer_id,
      es.user_id                                            AS participant_id,
      ROUND(
        es.amount_paise::NUMERIC
        * ep.amount_paise::NUMERIC
        / e.amount_paise::NUMERIC
      )::BIGINT                                             AS credit_paise
    FROM expenses e
    JOIN expense_payers ep ON ep.expense_id = e.id
    JOIN expense_shares es ON es.expense_id = e.id
    WHERE e.status = 'active'
      AND ep.user_id <> es.user_id  -- skip self-contribution entries
  ),

  -- What other users owe the caller (caller is payer, others are participants)
  caller_as_payer AS (
    SELECT participant_id AS other_user, credit_paise AS net
    FROM expense_ledger
    WHERE payer_id = (SELECT uid FROM caller)
  ),

  -- What the caller owes other users (caller is participant, others are payers)
  caller_as_participant AS (
    SELECT payer_id AS other_user, -credit_paise AS net
    FROM expense_ledger
    WHERE participant_id = (SELECT uid FROM caller)
  ),

  -- Confirmed settlements: caller paid someone → reduces what caller owes them
  -- (or if over-paid, creates a new credit for the caller)
  -- Sign convention: positive net means other_user owes caller.
  -- If caller paid other_user, caller's debt to them is reduced → net goes up by amount.
  caller_paid AS (
    SELECT recipient_id AS other_user, amount_paise AS net
    FROM settlements
    WHERE payer_id = (SELECT uid FROM caller) AND status = 'confirmed'
  ),

  -- Confirmed settlements: someone paid the caller → reduces their debt to the caller
  caller_received AS (
    SELECT payer_id AS other_user, -amount_paise AS net
    FROM settlements
    WHERE recipient_id = (SELECT uid FROM caller) AND status = 'confirmed'
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
    HAVING ABS(SUM(net)) >= 1  -- filter out sub-paise rounding noise
  )

  SELECT
    other_user              AS other_user_id,
    net_paise,
    GREATEST(net_paise, 0)::BIGINT  AS owed_to_paise,
    GREATEST(-net_paise, 0)::BIGINT AS owing_paise
  FROM aggregated;
$$;

REVOKE EXECUTE ON FUNCTION get_friend_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_friend_balances() TO authenticated;
