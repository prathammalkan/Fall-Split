-- Qualify the outer expense id so participant access compares against the
-- current expense row rather than the payer/share row's own id.
DROP POLICY IF EXISTS "expenses_participant_select" ON public.expenses;

CREATE POLICY "expenses_participant_select"
  ON public.expenses FOR SELECT
  USING (
    status <> 'deleted'
    AND (
      creator_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.expense_payers AS payer
        WHERE payer.expense_id = expenses.id
          AND payer.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.expense_shares AS share
        WHERE share.expense_id = expenses.id
          AND share.user_id = auth.uid()
      )
      OR (
        group_id IS NOT NULL
        AND public.is_group_member(auth.uid(), group_id)
      )
    )
  );
