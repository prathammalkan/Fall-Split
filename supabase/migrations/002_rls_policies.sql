-- ============================================================
-- Fall Split — Migration 002: Row Level Security Policies
-- ============================================================
-- Default-deny: no public access without explicit RLS policy.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_payers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_item_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log           ENABLE ROW LEVEL SECURITY;

-- ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

-- Check if two users are friends
CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friend_requests
    WHERE status = 'accepted'
      AND LEAST(sender_id, receiver_id)    = LEAST(user_a, user_b)
      AND GREATEST(sender_id, receiver_id) = GREATEST(user_a, user_b)
  );
$$;

-- Check if a user is an active member of a group
CREATE OR REPLACE FUNCTION public.is_group_member(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = p_user_id
      AND group_id = p_group_id
      AND removed_at IS NULL
  );
$$;

-- Check if a user is a group admin
CREATE OR REPLACE FUNCTION public.is_group_admin(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = p_user_id
      AND group_id = p_group_id
      AND role = 'admin'
      AND removed_at IS NULL
  );
$$;

-- Check if user can access an expense (is a payer or share recipient)
CREATE OR REPLACE FUNCTION public.can_access_expense(p_user_id UUID, p_expense_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.expenses e
    WHERE e.id = p_expense_id
      AND e.status <> 'deleted'
      AND (
        e.creator_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.expense_payers ep
          WHERE ep.expense_id = e.id AND ep.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.expense_shares es
          WHERE es.expense_id = e.id AND es.user_id = p_user_id
        )
        OR (
          e.group_id IS NOT NULL AND public.is_group_member(p_user_id, e.group_id)
        )
      )
  );
$$;

-- ─── PROFILES POLICIES ────────────────────────────────────────────────────────

-- Own profile: full access
CREATE POLICY "profiles_own_select"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id AND deleted_at IS NULL);

CREATE POLICY "profiles_own_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent users from elevating their own privileges via metadata
    -- (username/display_name/avatar/bio/upi_id only)
  );

-- Public username search (no email exposure, no financial data)
CREATE POLICY "profiles_username_search"
  ON public.profiles FOR SELECT
  USING (
    deleted_at IS NULL
    AND auth.uid() IS NOT NULL
    AND auth.uid() <> id
  );

-- ─── FRIEND REQUESTS POLICIES ─────────────────────────────────────────────────

CREATE POLICY "friend_requests_select"
  ON public.friend_requests FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (sender_id = auth.uid() OR receiver_id = auth.uid())
  );

CREATE POLICY "friend_requests_insert"
  ON public.friend_requests FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> receiver_id
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "friend_requests_update"
  ON public.friend_requests FOR UPDATE
  USING (
    -- Receiver can accept/reject; sender can cancel their own pending request
    (receiver_id = auth.uid() AND status = 'pending')
    OR (sender_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    (receiver_id = auth.uid() AND status IN ('accepted', 'rejected'))
    OR (sender_id = auth.uid() AND status = 'cancelled')
  );

-- ─── INVITATION TOKENS POLICIES ───────────────────────────────────────────────

CREATE POLICY "invitation_tokens_own_crud"
  ON public.invitation_tokens FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- Allow token lookup by token value (for accepting invitations)
CREATE POLICY "invitation_tokens_redeem"
  ON public.invitation_tokens FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
    AND use_count < max_uses
  );

-- ─── GROUPS POLICIES ──────────────────────────────────────────────────────────

CREATE POLICY "groups_member_select"
  ON public.groups FOR SELECT
  USING (public.is_group_member(auth.uid(), id));

CREATE POLICY "groups_creator_insert"
  ON public.groups FOR INSERT
  WITH CHECK (creator_id = auth.uid() AND auth.uid() IS NOT NULL);

CREATE POLICY "groups_admin_update"
  ON public.groups FOR UPDATE
  USING (public.is_group_admin(auth.uid(), id))
  WITH CHECK (public.is_group_admin(auth.uid(), id));

-- ─── GROUP MEMBERS POLICIES ───────────────────────────────────────────────────

CREATE POLICY "group_members_member_select"
  ON public.group_members FOR SELECT
  USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "group_members_admin_insert"
  ON public.group_members FOR INSERT
  WITH CHECK (public.is_group_admin(auth.uid(), group_id) OR (
    -- Creator can add themselves as first member
    EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.creator_id = auth.uid())
    AND user_id = auth.uid()
  ));

CREATE POLICY "group_members_admin_update"
  ON public.group_members FOR UPDATE
  USING (public.is_group_admin(auth.uid(), group_id))
  WITH CHECK (public.is_group_admin(auth.uid(), group_id));

-- Users can remove themselves
CREATE POLICY "group_members_self_leave"
  ON public.group_members FOR UPDATE
  USING (user_id = auth.uid() AND removed_at IS NULL)
  WITH CHECK (user_id = auth.uid());

-- ─── EXPENSES POLICIES ────────────────────────────────────────────────────────

CREATE POLICY "expenses_participant_select"
  ON public.expenses FOR SELECT
  USING (
    status <> 'deleted'
    AND (
      creator_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.expense_payers ep
        WHERE ep.expense_id = id AND ep.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.expense_shares es
        WHERE es.expense_id = id AND es.user_id = auth.uid()
      )
      OR (
        group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id)
      )
    )
  );

CREATE POLICY "expenses_creator_insert"
  ON public.expenses FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (group_id IS NULL OR public.is_group_member(auth.uid(), group_id))
  );

CREATE POLICY "expenses_creator_update"
  ON public.expenses FOR UPDATE
  USING (
    creator_id = auth.uid()
    AND status = 'active'
  )
  WITH CHECK (
    creator_id = auth.uid()
    AND (group_id IS NULL OR public.is_group_member(auth.uid(), group_id))
  );

-- ─── EXPENSE_PAYERS POLICIES ──────────────────────────────────────────────────

CREATE POLICY "expense_payers_select"
  ON public.expense_payers FOR SELECT
  USING (public.can_access_expense(auth.uid(), expense_id));

CREATE POLICY "expense_payers_insert"
  ON public.expense_payers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

CREATE POLICY "expense_payers_update"
  ON public.expense_payers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

CREATE POLICY "expense_payers_delete"
  ON public.expense_payers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

-- ─── EXPENSE_SHARES POLICIES ──────────────────────────────────────────────────

CREATE POLICY "expense_shares_select"
  ON public.expense_shares FOR SELECT
  USING (public.can_access_expense(auth.uid(), expense_id));

CREATE POLICY "expense_shares_insert"
  ON public.expense_shares FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

CREATE POLICY "expense_shares_update"
  ON public.expense_shares FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

CREATE POLICY "expense_shares_delete"
  ON public.expense_shares FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

-- ─── EXPENSE_ITEMS POLICIES ───────────────────────────────────────────────────

CREATE POLICY "expense_items_select"
  ON public.expense_items FOR SELECT
  USING (public.can_access_expense(auth.uid(), expense_id));

CREATE POLICY "expense_items_creator_mutate"
  ON public.expense_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND e.creator_id = auth.uid()
    )
  );

-- ─── EXPENSE_ITEM_ALLOCATIONS POLICIES ────────────────────────────────────────

CREATE POLICY "item_alloc_select"
  ON public.expense_item_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      WHERE ei.id = item_id
        AND public.can_access_expense(auth.uid(), ei.expense_id)
    )
  );

CREATE POLICY "item_alloc_creator_mutate"
  ON public.expense_item_allocations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      JOIN public.expenses e ON e.id = ei.expense_id
      WHERE ei.id = item_id AND e.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expense_items ei
      JOIN public.expenses e ON e.id = ei.expense_id
      WHERE ei.id = item_id AND e.creator_id = auth.uid()
    )
  );

-- ─── EXPENSE_HISTORY POLICIES ─────────────────────────────────────────────────

CREATE POLICY "expense_history_participant_select"
  ON public.expense_history FOR SELECT
  USING (public.can_access_expense(auth.uid(), expense_id));

-- ─── SETTLEMENTS POLICIES ─────────────────────────────────────────────────────

CREATE POLICY "settlements_parties_select"
  ON public.settlements FOR SELECT
  USING (
    payer_id = auth.uid()
    OR recipient_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id))
  );

CREATE POLICY "settlements_payer_insert"
  ON public.settlements FOR INSERT
  WITH CHECK (
    payer_id = auth.uid()
    AND payer_id <> recipient_id
    AND auth.uid() IS NOT NULL
  );

-- Only the payer may update (cancel, add notes) or the recipient (confirm/reject)
CREATE POLICY "settlements_parties_update"
  ON public.settlements FOR UPDATE
  USING (payer_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (
    -- Payer can cancel a proposed/pending settlement
    (payer_id = auth.uid() AND status = 'cancelled')
    -- Recipient can confirm or reject a proposed/pending settlement
    OR (recipient_id = auth.uid() AND status IN ('confirmed', 'rejected'))
  );

-- ─── NOTIFICATIONS POLICIES ───────────────────────────────────────────────────

CREATE POLICY "notifications_own"
  ON public.notifications FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── NOTIFICATION_PREFERENCES POLICIES ───────────────────────────────────────

CREATE POLICY "notification_prefs_own"
  ON public.notification_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── PUSH_SUBSCRIPTIONS POLICIES ─────────────────────────────────────────────

CREATE POLICY "push_subs_own"
  ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── IDEMPOTENCY_RECORDS POLICIES ────────────────────────────────────────────

CREATE POLICY "idempotency_own"
  ON public.idempotency_records FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── ACTIVITY_LOG POLICIES ───────────────────────────────────────────────────

CREATE POLICY "activity_log_own"
  ON public.activity_log FOR SELECT
  USING (user_id = auth.uid());
