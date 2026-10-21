-- SECURITY DEFINER bypasses RLS, so validate group membership inside the RPC.
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
SET search_path = public
AS $$
  WITH caller AS (
    SELECT auth.uid() AS uid
    WHERE auth.uid() IS NOT NULL
      AND public.is_group_member(auth.uid(), p_group_id)
  ),
  expense_ledger AS (
    SELECT
      ep.user_id AS payer_id,
      es.user_id AS participant_id,
      ROUND(
        es.amount_paise::NUMERIC
        * ep.amount_paise::NUMERIC
        / e.amount_paise::NUMERIC
      )::BIGINT AS credit_paise
    FROM public.expenses e
    JOIN public.expense_payers ep ON ep.expense_id = e.id
    JOIN public.expense_shares es ON es.expense_id = e.id
    WHERE e.status = 'active'
      AND e.group_id = p_group_id
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
  caller_paid AS (
    SELECT s.recipient_id AS other_user, s.amount_paise AS net
    FROM public.settlements s
    WHERE s.payer_id = (SELECT uid FROM caller)
      AND s.status = 'confirmed'
      AND s.group_id = p_group_id
  ),
  caller_received AS (
    SELECT s.payer_id AS other_user, -s.amount_paise AS net
    FROM public.settlements s
    WHERE s.recipient_id = (SELECT uid FROM caller)
      AND s.status = 'confirmed'
      AND s.group_id = p_group_id
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
    SELECT other_user, SUM(net)::BIGINT AS net_paise
    FROM all_flows
    GROUP BY other_user
    HAVING ABS(SUM(net)) >= 1
  )
  SELECT
    other_user,
    net_paise,
    GREATEST(net_paise, 0)::BIGINT,
    GREATEST(-net_paise, 0)::BIGINT
  FROM aggregated;
$$;

REVOKE EXECUTE ON FUNCTION public.get_group_balances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_balances(UUID) TO authenticated;
