BEGIN;

DO $preflight$
DECLARE
  v_table_count INTEGER;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected postgres role to narrow authenticated table privileges';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_table_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
  WHERE schema.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname IN (
      'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
      'expenses', 'expense_payers', 'expense_shares', 'expense_items',
      'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
      'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
    );

  IF v_table_count <> 17 THEN
    RAISE EXCEPTION 'Expected 17 Fall Split tables; found %', v_table_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
        'expenses', 'expense_payers', 'expense_shares', 'expense_items',
        'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
        'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
      )
      AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Refusing to change application table ACLs while RLS is disabled';
  END IF;
END;
$preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public.profiles,
  public.friend_requests,
  public.invitation_tokens,
  public.groups,
  public.group_members,
  public.expenses,
  public.expense_payers,
  public.expense_shares,
  public.expense_items,
  public.expense_item_allocations,
  public.expense_history,
  public.settlements,
  public.notifications,
  public.notification_preferences,
  public.push_subscriptions,
  public.idempotency_records,
  public.activity_log
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.discoverable_profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, username, display_name, avatar_url)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username, display_name, bio, upi_id)
  ON TABLE public.profiles TO authenticated;

GRANT SELECT (id, sender_id, receiver_id, status, created_at)
  ON TABLE public.friend_requests TO authenticated;
GRANT INSERT (sender_id, receiver_id)
  ON TABLE public.friend_requests TO authenticated;
GRANT UPDATE (status)
  ON TABLE public.friend_requests TO authenticated;
GRANT UPDATE (revoked_at)
  ON TABLE public.invitation_tokens TO authenticated;

GRANT SELECT
  ON TABLE public.groups, public.group_members, public.expenses,
    public.settlements, public.notifications TO authenticated;
GRANT UPDATE (status, voided_at, voided_by, void_reason)
  ON TABLE public.expenses TO authenticated;
GRANT SELECT (expense_id, user_id, amount_paise)
  ON TABLE public.expense_payers TO authenticated;
GRANT SELECT (expense_id, user_id, amount_paise, percentage, share_weight)
  ON TABLE public.expense_shares TO authenticated;
GRANT UPDATE (read_at)
  ON TABLE public.notifications TO authenticated;
GRANT SELECT ON TABLE public.discoverable_profiles TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $postflight$
BEGIN
  IF NOT has_schema_privilege('anon', 'public', 'USAGE')
    OR NOT has_schema_privilege('authenticated', 'public', 'USAGE')
    OR has_schema_privilege('anon', 'public', 'CREATE')
    OR has_schema_privilege('authenticated', 'public', 'CREATE')
  THEN
    RAISE EXCEPTION 'Unexpected public schema USAGE/CREATE privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS privilege
    WHERE schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
        'expenses', 'expense_payers', 'expense_shares', 'expense_items',
        'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
        'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
      )
      AND privilege.grantee = 'authenticated'::regrole
      AND privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Authenticated retains a table-wide write or elevated privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS privilege
    WHERE schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
        'expenses', 'expense_payers', 'expense_shares', 'expense_items',
        'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
        'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
      )
      AND privilege.grantee IN (0, 'anon'::regrole)
  ) THEN
    RAISE EXCEPTION 'Anonymous or PUBLIC retains direct application-table privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS default_acl
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = default_acl.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS privilege
    WHERE schema.nspname = 'public'
      AND default_acl.defaclrole = 'postgres'::regrole
      AND default_acl.defaclobjtype IN ('r', 'S')
      AND privilege.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'PUBLIC or API roles retain default table/sequence privileges';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.groups', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.group_members', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.expenses', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.settlements', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.discoverable_profiles', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.profiles', 'id', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.friend_requests', 'sender_id', 'INSERT')
    OR NOT has_column_privilege('authenticated', 'public.friend_requests', 'status', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.expenses', 'voided_at', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
  THEN
    RAISE EXCEPTION 'An expected narrow application privilege is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
        'expenses', 'expense_payers', 'expense_shares', 'expense_items',
        'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
        'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
      )
      AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS was unexpectedly disabled';
  END IF;
END;
$postflight$;

COMMIT;
