-- Enforce profile activity at the database boundary after reconciliation 013.
-- The function returns no profile data and derives identity only from auth.uid().
CREATE OR REPLACE FUNCTION public.is_active_account()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.deleted_at IS NULL
    );
$function$;

REVOKE ALL ON FUNCTION public.is_active_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_account() TO authenticated;

-- Relationship helpers are callable from RLS, so keep authenticated execution
-- but bind every lookup to the caller instead of accepting arbitrary user IDs.
CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND user_a = auth.uid()
    AND public.is_active_account()
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
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND public.is_active_account()
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
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND public.is_active_account()
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
SET row_security = off
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND public.is_active_account()
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

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_group_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_group_admin(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_access_expense(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_expense(UUID, UUID) TO authenticated;

-- Guard security-definer RPC writes as well as direct writes. The trigger uses
-- the request JWT identity; service-role jobs without auth.uid() remain usable.
CREATE OR REPLACE FUNCTION public.enforce_active_account_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_active_account_write() FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY[
    'profiles',
    'friend_requests',
    'invitation_tokens',
    'groups',
    'group_members',
    'expenses',
    'expense_payers',
    'expense_shares',
    'expense_items',
    'expense_item_allocations',
    'expense_history',
    'settlements',
    'notifications',
    'notification_preferences',
    'push_subscriptions',
    'idempotency_records',
    'activity_log'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY v_tables LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY active_account_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_active_account()) WITH CHECK (public.is_active_account())',
      v_table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER active_account_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_active_account_write()',
      v_table_name
    );
  END LOOP;
END;
$migration$;

-- A security-definer mutation can otherwise bypass RLS. Run deletion cleanup
-- while the caller is active, and tombstone the profile as the final update.
CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
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

  UPDATE public.profiles
  SET
    deleted_at = pg_catalog.now(),
    display_name = '[Deleted User]',
    username = 'deleted_' || pg_catalog.substring(pg_catalog.replace(v_user_id::TEXT, '-', ''), 1, 22),
    avatar_url = NULL,
    bio = NULL,
    upi_id = NULL,
    updated_at = pg_catalog.now()
  WHERE id = v_user_id
    AND deleted_at IS NULL
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Account profile not found or already deactivated' USING ERRCODE = 'P0002';
  END IF;

  RETURN pg_catalog.json_build_object('success', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
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

ALTER FUNCTION public.accept_invitation(TEXT) RENAME TO accept_invitation_internal;
REVOKE ALL ON FUNCTION public.accept_invitation_internal(TEXT) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  RETURN public.accept_invitation_internal(p_token);
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

ALTER FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) RENAME TO propose_settlement_internal;
REVOKE ALL ON FUNCTION public.propose_settlement_internal(UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.propose_settlement(
  p_recipient_id UUID,
  p_amount_paise BIGINT,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  RETURN public.propose_settlement_internal(p_recipient_id, p_amount_paise, p_idempotency_key);
END;
$function$;
REVOKE ALL ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) TO authenticated;

ALTER FUNCTION public.respond_to_settlement(UUID, TEXT) RENAME TO respond_to_settlement_internal;
REVOKE ALL ON FUNCTION public.respond_to_settlement_internal(UUID, TEXT) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.respond_to_settlement(p_settlement_id UUID, p_action TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  RETURN public.respond_to_settlement_internal(p_settlement_id, p_action);
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_settlement(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_settlement(UUID, TEXT) TO authenticated;

ALTER FUNCTION public.cancel_settlement(UUID) RENAME TO cancel_settlement_internal;
REVOKE ALL ON FUNCTION public.cancel_settlement_internal(UUID) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.cancel_settlement(p_settlement_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  RETURN public.cancel_settlement_internal(p_settlement_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_settlement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_settlement(UUID) TO authenticated;

-- Keep existing callable RPC names, but prevent inactive callers from using
-- SECURITY DEFINER reads to retrieve private profiles or financial balances.
ALTER FUNCTION public.get_profile_for_user(UUID) RENAME TO get_profile_for_user_internal;
REVOKE ALL ON FUNCTION public.get_profile_for_user_internal(UUID) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_profile_for_user(p_user_id UUID)
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
SET search_path = pg_catalog, public, auth, pg_temp
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
  FROM public.get_profile_for_user_internal(p_user_id) AS profile
  WHERE public.is_active_account();
$function$;
REVOKE ALL ON FUNCTION public.get_profile_for_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_user(UUID) TO authenticated;

ALTER FUNCTION public.get_settlement_recipient_upis() RENAME TO get_settlement_recipient_upis_internal;
REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis_internal() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_settlement_recipient_upis()
RETURNS TABLE (settlement_id UUID, upi_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT result.settlement_id, result.upi_id
  FROM public.get_settlement_recipient_upis_internal() AS result
  WHERE public.is_active_account();
$function$;
REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settlement_recipient_upis() TO authenticated;

ALTER FUNCTION public.get_friend_balances() RENAME TO get_friend_balances_internal;
REVOKE ALL ON FUNCTION public.get_friend_balances_internal() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_friend_balances()
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT result.other_user_id, result.net_paise, result.owed_to_paise, result.owing_paise
  FROM public.get_friend_balances_internal() AS result
  WHERE public.is_active_account();
$function$;
REVOKE ALL ON FUNCTION public.get_friend_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friend_balances() TO authenticated;

ALTER FUNCTION public.get_group_balances(UUID) RENAME TO get_group_balances_internal;
REVOKE ALL ON FUNCTION public.get_group_balances_internal(UUID) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_group_balances(p_group_id UUID)
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT result.other_user_id, result.net_paise, result.owed_to_paise, result.owing_paise
  FROM public.get_group_balances_internal(p_group_id) AS result
  WHERE public.is_active_account();
$function$;
REVOKE ALL ON FUNCTION public.get_group_balances(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_balances(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
