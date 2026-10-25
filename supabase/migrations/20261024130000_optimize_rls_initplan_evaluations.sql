-- Migration: 20261024130000_optimize_rls_initplan_evaluations.sql
-- Optimizes RLS policies by wrapping auth.uid() in scalar subqueries (SELECT auth.uid()),
-- preventing per-row re-evaluation and allowing PostgreSQL to execute them as InitPlans.
-- Preserves identical row-ownership, membership, invitation, and account-status access semantics.

-- 1. profiles
DROP POLICY IF EXISTS "profiles_own_select" ON public.profiles;
CREATE POLICY "profiles_own_select"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update"
  ON public.profiles FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_username_search" ON public.profiles;
CREATE POLICY "profiles_username_search"
  ON public.profiles FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT auth.uid()) <> id
    AND deleted_at IS NULL
  );

-- 2. friend_requests (preserves relationship authorization constraints from migration 015)
DROP POLICY IF EXISTS "friend_requests_select" ON public.friend_requests;
CREATE POLICY "friend_requests_select"
  ON public.friend_requests FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (sender_id = (SELECT auth.uid()) OR receiver_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "friend_requests_insert" ON public.friend_requests;
CREATE POLICY "friend_requests_insert"
  ON public.friend_requests FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND sender_id = (SELECT auth.uid())
    AND sender_id <> receiver_id
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "friend_requests_update" ON public.friend_requests;
CREATE POLICY "friend_requests_update"
  ON public.friend_requests FOR UPDATE
  USING (
    (receiver_id = (SELECT auth.uid()) AND status = 'pending')
    OR (sender_id = (SELECT auth.uid()) AND status = 'pending')
  )
  WITH CHECK (
    (receiver_id = (SELECT auth.uid()) AND status IN ('accepted', 'rejected'))
    OR (sender_id = (SELECT auth.uid()) AND status = 'cancelled')
  );

-- 3. invitation_tokens
DROP POLICY IF EXISTS "invitation_tokens_own_crud" ON public.invitation_tokens;
CREATE POLICY "invitation_tokens_own_crud"
  ON public.invitation_tokens FOR ALL
  USING (creator_id = (SELECT auth.uid()))
  WITH CHECK (creator_id = (SELECT auth.uid()));

-- 4. groups
DROP POLICY IF EXISTS "groups_member_select" ON public.groups;
CREATE POLICY "groups_member_select"
  ON public.groups FOR SELECT
  USING (public.is_group_member((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "groups_creator_insert" ON public.groups;
CREATE POLICY "groups_creator_insert"
  ON public.groups FOR INSERT
  WITH CHECK (creator_id = (SELECT auth.uid()) AND (SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "groups_admin_update" ON public.groups;
CREATE POLICY "groups_admin_update"
  ON public.groups FOR UPDATE
  USING (public.is_group_admin((SELECT auth.uid()), id))
  WITH CHECK (public.is_group_admin((SELECT auth.uid()), id));

-- 5. group_members
DROP POLICY IF EXISTS "group_members_member_select" ON public.group_members;
CREATE POLICY "group_members_member_select"
  ON public.group_members FOR SELECT
  USING (public.is_group_member((SELECT auth.uid()), group_id));

DROP POLICY IF EXISTS "group_members_admin_insert" ON public.group_members;
CREATE POLICY "group_members_admin_insert"
  ON public.group_members FOR INSERT
  WITH CHECK (
    public.is_group_admin((SELECT auth.uid()), group_id)
    OR (
      EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.creator_id = (SELECT auth.uid()))
      AND user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "group_members_admin_update" ON public.group_members;
CREATE POLICY "group_members_admin_update"
  ON public.group_members FOR UPDATE
  USING (public.is_group_admin((SELECT auth.uid()), group_id))
  WITH CHECK (public.is_group_admin((SELECT auth.uid()), group_id));

-- 6. expenses (preserves participant visibility from migration 017)
DROP POLICY IF EXISTS "expenses_participant_select" ON public.expenses;
CREATE POLICY "expenses_participant_select"
  ON public.expenses FOR SELECT
  USING (
    status <> 'deleted'
    AND (
      creator_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.expense_payers payer
        WHERE payer.expense_id = expenses.id AND payer.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.expense_shares share
        WHERE share.expense_id = expenses.id AND share.user_id = (SELECT auth.uid())
      )
      OR (
        group_id IS NOT NULL AND public.is_group_member((SELECT auth.uid()), group_id)
      )
    )
  );

DROP POLICY IF EXISTS "expenses_creator_insert" ON public.expenses;
CREATE POLICY "expenses_creator_insert"
  ON public.expenses FOR INSERT
  WITH CHECK (
    creator_id = (SELECT auth.uid())
    AND (SELECT auth.uid()) IS NOT NULL
    AND (group_id IS NULL OR public.is_group_member((SELECT auth.uid()), group_id))
  );

DROP POLICY IF EXISTS "expenses_creator_update" ON public.expenses;
CREATE POLICY "expenses_creator_update"
  ON public.expenses FOR UPDATE
  USING (
    creator_id = (SELECT auth.uid())
    AND status = 'active'
  )
  WITH CHECK (
    creator_id = (SELECT auth.uid())
    AND (group_id IS NULL OR public.is_group_member((SELECT auth.uid()), group_id))
  );

-- 7. expense_payers
DROP POLICY IF EXISTS "expense_payers_select" ON public.expense_payers;
CREATE POLICY "expense_payers_select"
  ON public.expense_payers FOR SELECT
  USING (public.can_access_expense((SELECT auth.uid()), expense_id));

DROP POLICY IF EXISTS "expense_payers_insert" ON public.expense_payers;
CREATE POLICY "expense_payers_insert"
  ON public.expense_payers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "expense_payers_update" ON public.expense_payers;
CREATE POLICY "expense_payers_update"
  ON public.expense_payers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "expense_payers_delete" ON public.expense_payers;
CREATE POLICY "expense_payers_delete"
  ON public.expense_payers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

-- 8. expense_shares
DROP POLICY IF EXISTS "expense_shares_select" ON public.expense_shares;
CREATE POLICY "expense_shares_select"
  ON public.expense_shares FOR SELECT
  USING (public.can_access_expense((SELECT auth.uid()), expense_id));

DROP POLICY IF EXISTS "expense_shares_insert" ON public.expense_shares;
CREATE POLICY "expense_shares_insert"
  ON public.expense_shares FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "expense_shares_update" ON public.expense_shares;
CREATE POLICY "expense_shares_update"
  ON public.expense_shares FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "expense_shares_delete" ON public.expense_shares;
CREATE POLICY "expense_shares_delete"
  ON public.expense_shares FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

-- 9. expense_items
DROP POLICY IF EXISTS "expense_items_select" ON public.expense_items;
CREATE POLICY "expense_items_select"
  ON public.expense_items FOR SELECT
  USING (public.can_access_expense((SELECT auth.uid()), expense_id));

DROP POLICY IF EXISTS "expense_items_creator_mutate" ON public.expense_items;
CREATE POLICY "expense_items_creator_mutate"
  ON public.expense_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = (SELECT auth.uid())
    )
  );

-- 10. expense_item_allocations
DROP POLICY IF EXISTS "item_alloc_select" ON public.expense_item_allocations;
CREATE POLICY "item_alloc_select"
  ON public.expense_item_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      WHERE ei.id = item_id
        AND public.can_access_expense((SELECT auth.uid()), ei.expense_id)
    )
  );

DROP POLICY IF EXISTS "item_alloc_creator_mutate" ON public.expense_item_allocations;
CREATE POLICY "item_alloc_creator_mutate"
  ON public.expense_item_allocations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      JOIN public.expenses e ON e.id = ei.expense_id
      WHERE ei.id = item_id AND e.creator_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      JOIN public.expenses e ON e.id = ei.expense_id
      WHERE ei.id = item_id AND e.creator_id = (SELECT auth.uid())
    )
  );

-- 11. expense_history
DROP POLICY IF EXISTS "expense_history_participant_select" ON public.expense_history;
CREATE POLICY "expense_history_participant_select"
  ON public.expense_history FOR SELECT
  USING (public.can_access_expense((SELECT auth.uid()), expense_id));

-- 12. settlements
DROP POLICY IF EXISTS "settlements_parties_select" ON public.settlements;
CREATE POLICY "settlements_parties_select"
  ON public.settlements FOR SELECT
  USING (
    payer_id = (SELECT auth.uid())
    OR recipient_id = (SELECT auth.uid())
    OR (group_id IS NOT NULL AND public.is_group_member((SELECT auth.uid()), group_id))
  );

DROP POLICY IF EXISTS "settlements_payer_insert" ON public.settlements;
CREATE POLICY "settlements_payer_insert"
  ON public.settlements FOR INSERT
  WITH CHECK (
    payer_id = (SELECT auth.uid())
    AND payer_id <> recipient_id
    AND (SELECT auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "settlements_parties_update" ON public.settlements;
CREATE POLICY "settlements_parties_update"
  ON public.settlements FOR UPDATE
  USING (
    payer_id = (SELECT auth.uid()) OR recipient_id = (SELECT auth.uid())
  )
  WITH CHECK (
    (payer_id = (SELECT auth.uid()) AND status = 'cancelled')
    OR (recipient_id = (SELECT auth.uid()) AND status IN ('confirmed', 'rejected'))
  );

-- 13. notifications, preferences, push subscriptions, idempotency, activity log
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own"
  ON public.notifications FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notification_prefs_own" ON public.notification_preferences;
CREATE POLICY "notification_prefs_own"
  ON public.notification_preferences FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "push_subs_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_own"
  ON public.push_subscriptions FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "idempotency_own" ON public.idempotency_records;
CREATE POLICY "idempotency_own"
  ON public.idempotency_records FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "activity_log_own" ON public.activity_log;
CREATE POLICY "activity_log_own"
  ON public.activity_log FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- 14. expense_approvals (if table exists from migration 20261024120000)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expense_approvals') THEN
    DROP POLICY IF EXISTS "expense_approvals_select" ON public.expense_approvals;
    CREATE POLICY "expense_approvals_select"
      ON public.expense_approvals FOR SELECT
      TO authenticated
      USING (public.can_access_expense((SELECT auth.uid()), expense_id));
  END IF;
END$$;
