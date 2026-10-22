BEGIN;

DO $preflight$
DECLARE
  v_table_count INTEGER;
  v_expected_policy TEXT[];
  v_expected_policies TEXT[][] := ARRAY[
    ['friend_requests', 'friend_requests_insert', '48bb9ca3bb21087b7a71a403678a5939'],
    ['friend_requests', 'friend_requests_select', 'fc30dd7507887ee2de63fe4781d04210'],
    ['group_members', 'group_members_member_select', '00d29243ad37fb4596cfc30ea14aa018'],
    ['groups', 'groups_member_select', 'dfe015cabc16a5f392b9b17d4a01d502'],
    ['expenses', 'expenses_participant_select', 'e7101ee5effe928695c084e9918157b6'],
    ['expense_payers', 'expense_payers_select', '8ad7805d9cf96f70f2d7f421093e7ff0'],
    ['expense_shares', 'expense_shares_select', 'da41965f481a8553167f00efe73e2929'],
    ['settlements', 'settlements_parties_select', '52fd017fa5cf7143a061e89d2708fb90'],
    ['notifications', 'notifications_own', 'bccfa983ecba63cfebbac4dfda9cb87f']
  ];
  v_actual_policy_hash TEXT;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected postgres role to restore PostgREST grants';
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
    RAISE EXCEPTION 'Refusing to grant API access while an application table lacks RLS';
  END IF;

  FOREACH v_expected_policy SLICE 1 IN ARRAY v_expected_policies LOOP
    SELECT md5(concat_ws(E'\x1f',
      schema.nspname,
      relation.relname,
      policy.polname,
      policy.polcmd::TEXT,
      policy.polpermissive::TEXT,
      COALESCE((
        SELECT string_agg(
          CASE WHEN role_oid = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(role_oid) END,
          ',' ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(role_oid) END
        )
        FROM unnest(policy.polroles) AS role_oid
      ), ''),
      COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '<NULL>'),
      COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '<NULL>')
    ))
    INTO v_actual_policy_hash
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relname = v_expected_policy[1]
      AND policy.polname = v_expected_policy[2];

    IF v_actual_policy_hash IS DISTINCT FROM v_expected_policy[3] THEN
      RAISE EXCEPTION 'RLS policy drift on public.%.%',
        v_expected_policy[1], v_expected_policy[2];
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relname = 'discoverable_profiles'
      AND relation.relkind = 'v'
      AND relation.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'Expected discoverable_profiles to remain a security-invoker view';
  END IF;

  IF to_regprocedure('public.get_profile_for_user(uuid)') IS NULL
    OR to_regprocedure('public.get_friend_balances()') IS NULL
    OR to_regprocedure('public.get_group_balances(uuid)') IS NULL
    OR to_regprocedure('public.get_settlement_recipient_upis()') IS NULL
    OR to_regprocedure('public.get_invitation_preview(text)') IS NULL
  THEN
    RAISE EXCEPTION 'Required caller-bound or public-preview RPC is missing';
  END IF;
END;
$preflight$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT (id, sender_id, receiver_id, status, created_at)
  ON TABLE public.friend_requests TO authenticated;
GRANT INSERT (sender_id, receiver_id)
  ON TABLE public.friend_requests TO authenticated;
GRANT SELECT
  ON TABLE public.groups, public.group_members, public.expenses,
    public.settlements, public.notifications TO authenticated;
GRANT SELECT (expense_id, user_id, amount_paise)
  ON TABLE public.expense_payers TO authenticated;
GRANT SELECT (expense_id, user_id, amount_paise, percentage, share_weight)
  ON TABLE public.expense_shares TO authenticated;
GRANT UPDATE (read_at)
  ON TABLE public.notifications TO authenticated;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_settlement_history_mutation()
  FROM PUBLIC, anon, authenticated;

DO $postflight$
BEGIN
  IF NOT has_schema_privilege('anon', 'public', 'USAGE')
    OR NOT has_schema_privilege('authenticated', 'public', 'USAGE')
  THEN
    RAISE EXCEPTION 'PostgREST roles still lack public schema USAGE';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
    OR has_schema_privilege('authenticated', 'public', 'CREATE')
  THEN
    RAISE EXCEPTION 'API roles must not receive public schema CREATE';
  END IF;

  IF has_table_privilege('anon', 'public.friend_requests', 'SELECT')
    OR has_table_privilege('anon', 'public.groups', 'SELECT')
    OR has_table_privilege('anon', 'public.expenses', 'SELECT')
    OR has_table_privilege('anon', 'public.settlements', 'SELECT')
    OR has_table_privilege('anon', 'public.notifications', 'SELECT')
  THEN
    RAISE EXCEPTION 'Anonymous app-table reads must remain revoked';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.friend_requests', 'sender_id', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.friend_requests', 'receiver_id', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.friend_requests', 'sender_id', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.groups', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.group_members', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.expenses', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.expense_payers', 'expense_id', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.expense_shares', 'expense_id', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.settlements', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
  THEN
    RAISE EXCEPTION 'An expected authenticated PostgREST privilege is missing';
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_invitation_preview(text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_friend_balances()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.prevent_settlement_history_mutation()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_friend_balances()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'RPC execute boundaries changed unexpectedly';
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
