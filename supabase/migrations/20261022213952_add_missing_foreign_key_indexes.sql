CREATE INDEX IF NOT EXISTS activity_log_actor_id_idx
  ON public.activity_log (actor_id);

CREATE INDEX IF NOT EXISTS expense_history_changed_by_idx
  ON public.expense_history (changed_by);

CREATE INDEX IF NOT EXISTS expenses_voided_by_idx
  ON public.expenses (voided_by);

CREATE INDEX IF NOT EXISTS group_members_invited_by_idx
  ON public.group_members (invited_by);
