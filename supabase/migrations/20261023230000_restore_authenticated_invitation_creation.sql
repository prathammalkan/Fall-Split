BEGIN;

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected postgres role to restore invitation creation privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relname = 'invitation_tokens'
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Refusing to grant invitation privileges while invitation_tokens lacks RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    WHERE relation.relname = 'invitation_tokens'
      AND trigger_row.tgname = 'invitation_token_integrity'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Expected invitation_token_integrity trigger on public.invitation_tokens';
  END IF;
END;
$preflight$;

-- Grant column-level SELECT on invitation_tokens so creators can inspect their tokens
-- under the existing invitation_tokens_own_crud RLS policy.
GRANT SELECT (id, token, type, creator_id, target_id, max_uses, use_count, expires_at, created_at, revoked_at)
  ON TABLE public.invitation_tokens TO authenticated;

-- Grant column-level INSERT for the payload fields required by ShareInviteModal.
-- Token creator is restricted to auth.uid() by RLS and enforce_invitation_token_integrity().
GRANT INSERT (token, type, creator_id, target_id, max_uses, expires_at)
  ON TABLE public.invitation_tokens TO authenticated;

DO $postflight$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'token', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'creator_id', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'type', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'target_id', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'max_uses', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'expires_at', 'INSERT')
  THEN
    RAISE EXCEPTION 'Missing expected authenticated INSERT privileges on invitation_tokens';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'token', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'creator_id', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.invitation_tokens', 'id', 'SELECT')
  THEN
    RAISE EXCEPTION 'Missing expected authenticated SELECT privileges on invitation_tokens';
  END IF;

  IF has_table_privilege('anon', 'public.invitation_tokens', 'SELECT')
    OR has_table_privilege('anon', 'public.invitation_tokens', 'INSERT')
    OR has_table_privilege('anon', 'public.invitation_tokens', 'UPDATE')
    OR has_table_privilege('anon', 'public.invitation_tokens', 'DELETE')
  THEN
    RAISE EXCEPTION 'Anonymous access to invitation_tokens must remain completely revoked';
  END IF;

  IF has_column_privilege('authenticated', 'public.invitation_tokens', 'use_count', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.invitation_tokens', 'token', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.invitation_tokens', 'creator_id', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.invitation_tokens', 'DELETE')
  THEN
    RAISE EXCEPTION 'Excessive authenticated privileges detected on invitation_tokens';
  END IF;
END;
$postflight$;

COMMIT;
