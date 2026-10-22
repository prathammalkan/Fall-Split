-- The production project currently grants anon and authenticated table-wide
-- privileges, including TRUNCATE (which bypasses RLS), TRIGGER, REFERENCES,
-- and PostgreSQL 17 MAINTAIN, on every application table. Keep authenticated
-- row-level CRUD grants for the existing app policies, remove all direct
-- anonymous table access, and prevent future postgres-owned app tables from
-- inheriting these excessive grants. Do not touch Supabase-managed schemas.
DO $migration$
DECLARE
  v_app_tables TEXT[] := ARRAY[
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
  v_table_count INTEGER;
  v_table_name TEXT;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected the postgres role to own and reconcile application-table privileges';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_table_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
  WHERE schema.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname = ANY (v_app_tables);

  IF v_table_count <> pg_catalog.cardinality(v_app_tables) THEN
    RAISE EXCEPTION 'Expected all % application tables before privilege reconciliation; found %',
      pg_catalog.cardinality(v_app_tables), v_table_count;
  END IF;

  FOREACH v_table_name IN ARRAY v_app_tables LOOP
    EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon',
      v_table_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM authenticated',
      v_table_name
    );
  END LOOP;
END;
$migration$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM authenticated;
