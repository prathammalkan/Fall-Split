-- Prevent direct friend-request writes from manufacturing accepted friendships
-- or changing the users attached to an existing request.
DROP POLICY IF EXISTS "friend_requests_insert" ON public.friend_requests;
CREATE POLICY "friend_requests_insert"
  ON public.friend_requests FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND sender_id = auth.uid()
    AND sender_id <> receiver_id
    AND status = 'pending'
  );

REVOKE UPDATE ON TABLE public.friend_requests FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON TABLE public.friend_requests TO authenticated;

-- Group invitations are a privileged way to create memberships. Only an
-- active group admin may create one; token identity and redemption limits
-- cannot be rewritten by the token owner.
CREATE OR REPLACE FUNCTION public.enforce_invitation_token_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      NEW.id, NEW.token, NEW.type, NEW.creator_id, NEW.target_id,
      NEW.max_uses, NEW.expires_at, NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.id, OLD.token, OLD.type, OLD.creator_id, OLD.target_id,
      OLD.max_uses, OLD.expires_at, OLD.created_at
    ) THEN
      RAISE EXCEPTION 'Invitation identity and redemption limits cannot be changed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.use_count < OLD.use_count THEN
      RAISE EXCEPTION 'Invitation use count cannot be decreased'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.use_count > OLD.use_count
      AND OLD.type = 'group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.group_members AS member
        WHERE member.group_id = OLD.target_id
          AND member.user_id = OLD.creator_id
          AND member.role = 'admin'
          AND member.removed_at IS NULL
      )
    THEN
      RAISE EXCEPTION 'Group invitation creator must remain an active group admin'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.creator_id <> auth.uid() THEN
    RAISE EXCEPTION 'Invitation creator must be the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.type = 'friend' AND NEW.target_id IS NOT NULL THEN
    RAISE EXCEPTION 'Friend invitations cannot target a group'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.type = 'group' AND (
    NEW.target_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.group_members AS member
      WHERE member.group_id = NEW.target_id
        AND member.user_id = NEW.creator_id
        AND member.role = 'admin'
        AND member.removed_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Group invitations require an active group admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_invitation_token_integrity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitation_token_integrity
  BEFORE INSERT OR UPDATE ON public.invitation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation_token_integrity();

REVOKE UPDATE ON TABLE public.invitation_tokens FROM PUBLIC, anon, authenticated;
GRANT UPDATE (revoked_at) ON TABLE public.invitation_tokens TO authenticated;
