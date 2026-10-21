-- Expose only the inviter's display name and invitation type before sign-in.
-- High-entropy invitation tokens are required; no group/private data is returned.
-- Token lookup must go through this function; RLS must not expose every live token.
DROP POLICY IF EXISTS "invitation_tokens_redeem" ON public.invitation_tokens;

CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'type', invitation.type,
    'creator_name', profile.display_name
  )
  FROM public.invitation_tokens AS invitation
  JOIN public.profiles AS profile ON profile.id = invitation.creator_id
  WHERE invitation.token = p_token
    AND profile.deleted_at IS NULL
    AND invitation.revoked_at IS NULL
    AND (invitation.expires_at IS NULL OR invitation.expires_at > NOW())
    AND invitation.use_count < invitation.max_uses
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_invitation_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(TEXT) TO anon, authenticated;
