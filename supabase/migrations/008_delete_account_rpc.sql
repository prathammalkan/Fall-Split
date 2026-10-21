-- Migration 008: Add delete_account SQL function
-- Replaces the Edge Function dependency with a SECURITY DEFINER RPC
-- that the client can call directly with their JWT.

CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;

  -- 1. Soft-delete and anonymize the profile
  UPDATE public.profiles
  SET
    deleted_at   = NOW(),
    display_name = '[Deleted User]',
    username     = 'deleted_' || substring(v_user_id::text, 1, 8),
    avatar_url   = NULL,
    bio          = NULL,
    upi_id       = NULL,
    updated_at   = NOW()
  WHERE id = v_user_id;

  -- 2. Remove from all active group memberships
  UPDATE public.group_members
  SET removed_at = NOW()
  WHERE user_id = v_user_id
    AND removed_at IS NULL;

  -- 3. Cancel pending friend requests
  UPDATE public.friend_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE (sender_id = v_user_id OR receiver_id = v_user_id)
    AND status = 'pending';

  -- 4. Revoke all invitation tokens
  UPDATE public.invitation_tokens
  SET revoked_at = NOW()
  WHERE creator_id = v_user_id
    AND revoked_at IS NULL;

  -- 5. Cancel any proposed/pending settlements they initiated
  UPDATE public.settlements
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE payer_id = v_user_id
    AND status IN ('proposed', 'pending');

  -- Note: The auth.users deletion must happen client-side after this call
  -- using supabase.auth.admin.deleteUser() — the client signs out immediately
  -- after calling this function, rendering the account inaccessible.
  -- For full auth deletion, the Edge Function handles step 5 when deployed.

  RETURN json_build_object('success', true);
END;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;
