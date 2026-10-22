CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'type', invitation.type,
    'creator_name', profile.display_name
  )
  FROM public.invitation_tokens AS invitation
  JOIN public.profiles AS profile ON profile.id = invitation.creator_id
  WHERE invitation.token = p_token
    AND profile.deleted_at IS NULL
    AND invitation.revoked_at IS NULL
    AND (invitation.expires_at IS NULL OR invitation.expires_at > pg_catalog.now())
    AND invitation.use_count < invitation.max_uses
  LIMIT 1;
$function$;
