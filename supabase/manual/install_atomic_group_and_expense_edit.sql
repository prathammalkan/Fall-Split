-- Reviewed standalone installer for the two RPCs called by the current UI.
-- This is NOT a migration and intentionally does not create/update migration history.
-- Run only after independently confirming the Supabase project reference and backup.
-- It aborts unless the inspected production catalog matches the prerequisites below.
-- In particular, do not bypass the is_active_account() check: if absent, reconcile
-- the prerequisite active-account migration and its related policies/triggers first.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, auth, pg_temp;

SELECT current_database() AS database_name,
       current_user AS operator_role,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       version() AS server_version;

DO $preflight$
DECLARE
  v_missing TEXT;
  v_mismatch TEXT;
  v_rel RECORD;
BEGIN
  IF current_database() IS NULL OR current_user IS NULL THEN
    RAISE EXCEPTION 'Cannot establish database identity';
  END IF;
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'Preflight expected the Supabase postgres database on PostgreSQL 17; found database %, version %',
      current_database(), current_setting('server_version');
  END IF;

  -- This script assumes the reported production state; do not run it against a
  -- different database or after a ledger has appeared without re-review.
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration ledger now exists; stop and reconcile the migration plan first';
  END IF;

  SELECT string_agg(required, ', ') INTO v_missing
  FROM (VALUES
    ('role anon', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')),
    ('role authenticated', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')),
    ('schema public', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')),
    ('schema auth', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')),
    ('auth.uid()', to_regprocedure('auth.uid()') IS NOT NULL),
    ('public.profiles', to_regclass('public.profiles') IS NOT NULL),
    ('public.groups', to_regclass('public.groups') IS NOT NULL),
    ('public.group_members', to_regclass('public.group_members') IS NOT NULL),
    ('public.expenses', to_regclass('public.expenses') IS NOT NULL),
    ('public.expense_payers', to_regclass('public.expense_payers') IS NOT NULL),
    ('public.expense_shares', to_regclass('public.expense_shares') IS NOT NULL),
    ('public.expense_items', to_regclass('public.expense_items') IS NOT NULL)
  ) AS required_objects(required, present)
  WHERE NOT present;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight missing prerequisites: %', v_missing;
  END IF;
  IF to_regprocedure('public.is_active_account()') IS NULL THEN
    RAISE EXCEPTION 'Blocked: public.is_active_account() is absent. Reconcile the prerequisite active-account migration and its related policies/triggers before installing these RPCs; no changes were applied.';
  END IF;

  -- Verify the exact column types and nullability consumed by the RPC bodies.
  WITH expected(table_name, column_name, type_name, is_not_null) AS (
    VALUES
      ('profiles','id','uuid',true), ('profiles','deleted_at','timestamp with time zone',false),
      ('groups','id','uuid',true), ('groups','name','text',true),
      ('groups','description','text',false), ('groups','type','group_type',true),
      ('groups','currency','text',true), ('groups','creator_id','uuid',true),
      ('group_members','group_id','uuid',true), ('group_members','user_id','uuid',true),
      ('group_members','role','member_role',true),
      ('expenses','id','uuid',true), ('expenses','title','text',true),
      ('expenses','amount_paise','bigint',true), ('expenses','split_method','split_method',true),
      ('expenses','creator_id','uuid',true), ('expenses','status','expense_status',true),
      ('expenses','updated_at','timestamp with time zone',true), ('expenses','expense_date','date',true),
      ('expenses','notes','text',false), ('expenses','category','text',false),
      ('expense_payers','id','uuid',true), ('expense_payers','expense_id','uuid',true),
      ('expense_payers','user_id','uuid',true), ('expense_payers','amount_paise','bigint',true),
      ('expense_shares','id','uuid',true), ('expense_shares','expense_id','uuid',true),
      ('expense_shares','user_id','uuid',true), ('expense_shares','amount_paise','int8',true),
      ('expense_shares','percentage','numeric(5,2)',false),
      ('expense_shares','share_weight','numeric',false),
      ('expense_items','expense_id','uuid',true)
  ), actual AS (
    SELECT c.relname AS table_name, a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name,
           a.attnotnull AS is_not_null
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  SELECT string_agg(format('%s.%s: expected %s%s, found %s%s',
                           e.table_name, e.column_name, e.type_name,
                           CASE WHEN e.is_not_null THEN ' NOT NULL' ELSE ' NULLABLE' END,
                           coalesce(a.type_name, 'MISSING'),
                           CASE WHEN a.is_not_null THEN ' NOT NULL' ELSE ' NULLABLE' END), '; ')
    INTO v_mismatch
  FROM expected e
  LEFT JOIN actual a USING (table_name, column_name)
  WHERE a.type_name IS DISTINCT FROM e.type_name
     OR a.is_not_null IS DISTINCT FROM e.is_not_null;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight column mismatch: %', v_mismatch;
  END IF;

  -- Confirm enum labels explicitly consumed by the functions.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'group_type'
      AND (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
           FROM pg_enum e WHERE e.enumtypid = t.oid)
          = ARRAY['trip','household','event','custom']::text[]
  ) THEN RAISE EXCEPTION 'Preflight enum mismatch: public.group_type'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'member_role'
      AND EXISTS (SELECT 1 FROM pg_enum e WHERE e.enumtypid = t.oid AND e.enumlabel = 'admin')
  ) THEN RAISE EXCEPTION 'Preflight enum mismatch: public.member_role.admin'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'split_method'
      AND EXISTS (SELECT 1 FROM pg_enum e WHERE e.enumtypid = t.oid AND e.enumlabel = 'equal')
  ) THEN RAISE EXCEPTION 'Preflight enum mismatch: public.split_method.equal'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'expense_status'
      AND EXISTS (SELECT 1 FROM pg_enum e WHERE e.enumtypid = t.oid AND e.enumlabel = 'active')
  ) THEN RAISE EXCEPTION 'Preflight enum mismatch: public.expense_status.active'; END IF;

  -- Constraints that protect the rows created or recalculated by these RPCs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.groups'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%char_length(name)%80%') THEN
    RAISE EXCEPTION 'Preflight missing groups name-length check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.groups'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%currency%^[A-Z]{3}%') THEN
    RAISE EXCEPTION 'Preflight missing groups currency-format check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.group_members'::regclass AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (group_id, user_id)%') THEN
    RAISE EXCEPTION 'Preflight missing unique group membership constraint';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.groups'::regclass AND a.attname = 'id'
      AND a.atttypid = 'uuid'::regtype
      AND (pg_get_expr(d.adbin, d.adrelid) ILIKE '%uuid_generate_v4()%'
           OR pg_get_expr(d.adbin, d.adrelid) ILIKE '%gen_random_uuid()%')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.group_members'::regclass AND a.attname = 'id'
      AND a.atttypid = 'uuid'::regtype
      AND (pg_get_expr(d.adbin, d.adrelid) ILIKE '%uuid_generate_v4()%'
           OR pg_get_expr(d.adbin, d.adrelid) ILIKE '%gen_random_uuid()%')
  ) THEN RAISE EXCEPTION 'Preflight groups/group_members.id must use a UUID generator default'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = 'public.groups'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = 'public.expenses'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = 'public.expense_payers'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'id'
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight requires primary keys on groups.id, expenses.id, expense_payers.id and expense_shares.id'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expenses'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%amount_paise%> 0%') THEN
    RAISE EXCEPTION 'Preflight missing positive expense amount check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expenses'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%char_length(title)%120%') THEN
    RAISE EXCEPTION 'Preflight missing expense title-length check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expense_payers'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%amount_paise%> 0%') THEN
    RAISE EXCEPTION 'Preflight missing positive payer amount check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expense_payers'::regclass AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (expense_id, user_id)%') THEN
    RAISE EXCEPTION 'Preflight missing unique payer-per-expense constraint';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%amount_paise%>= 0%') THEN
    RAISE EXCEPTION 'Preflight missing nonnegative share amount check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (expense_id, user_id)%') THEN
    RAISE EXCEPTION 'Preflight missing unique share-per-expense constraint';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%percentage%>= 0%100%') THEN
    RAISE EXCEPTION 'Preflight missing valid percentage-range check';
  END IF;
  -- The edit RPC filters payer/share/item rows by expense_id. Require valid
  -- leading-column indexes for those lookups; no other named index is referenced.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'expense_id'
    WHERE i.indrelid = 'public.expense_payers'::regclass
      AND i.indisvalid AND i.indisready AND i.indkey[0] = a.attnum
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'expense_id'
    WHERE i.indrelid = 'public.expense_shares'::regclass
      AND i.indisvalid AND i.indisready AND i.indkey[0] = a.attnum
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'expense_id'
    WHERE i.indrelid = 'public.expense_items'::regclass
      AND i.indisvalid AND i.indisready AND i.indkey[0] = a.attnum
  ) THEN RAISE EXCEPTION 'Preflight missing valid leading expense_id index on payer/share/item tables'; END IF;

  -- Required single-column FK relationships; match catalog column identities,
  -- not constraint names, since names can differ between equivalent schemas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'creator_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.groups'::regclass AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing groups.creator_id -> profiles.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'group_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.group_members'::regclass AND c.confrelid = 'public.groups'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing group_members.group_id -> groups.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'user_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.group_members'::regclass AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing group_members.user_id -> profiles.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'creator_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expenses'::regclass AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expenses.creator_id -> profiles.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'expense_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expense_payers'::regclass AND c.confrelid = 'public.expenses'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expense_payers.expense_id -> expenses.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'user_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expense_payers'::regclass AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expense_payers.user_id -> profiles.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'expense_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.confrelid = 'public.expenses'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expense_shares.expense_id -> expenses.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'user_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expense_shares'::regclass AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expense_shares.user_id -> profiles.id FK'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute la ON la.attrelid = c.conrelid AND la.attname = 'expense_id'
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attname = 'id'
    WHERE c.conrelid = 'public.expense_items'::regclass AND c.confrelid = 'public.expenses'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[la.attnum]::smallint[]
      AND c.confkey = ARRAY[ra.attnum]::smallint[]
  ) THEN RAISE EXCEPTION 'Preflight missing expense_items.expense_id -> expenses.id FK'; END IF;

  -- Required RLS and updated_at behavior. The RPCs are SECURITY DEFINER with
  -- row_security=off, so their body authorization is authoritative; policies
  -- are reported after installation and are not modified by this script.
  FOR v_rel IN
    SELECT c.oid::regclass AS relation_name, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('groups','group_members','expenses','expense_payers','expense_shares','expense_items')
  LOOP
    IF NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'Preflight requires RLS enabled on %', v_rel.relation_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.expenses'::regclass
      AND t.tgname = 'set_updated_at_expenses' AND NOT t.tgisinternal
      AND t.tgfoid = 'public.set_updated_at()'::regprocedure
      AND pg_get_triggerdef(t.oid) ILIKE '%BEFORE UPDATE%'
  ) THEN RAISE EXCEPTION 'Preflight missing BEFORE UPDATE set_updated_at_expenses trigger'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.set_updated_at()'::regprocedure
      AND p.prosrc ILIKE '%NEW.updated_at%NOW()%'
  ) THEN RAISE EXCEPTION 'Preflight set_updated_at() does not refresh updated_at'; END IF;

  -- The definer of these functions must be able to bypass RLS and have the
  -- explicit object privileges used by the bodies; this avoids silently
  -- depending on a provider-specific owner assumption.
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user
                 AND (r.rolsuper OR r.rolbypassrls)) THEN
    RAISE EXCEPTION 'Preflight requires current role % to have BYPASSRLS', current_user;
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE')
     OR NOT has_schema_privilege(current_user, 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'Preflight current role lacks CREATE on public or USAGE on auth';
  END IF;
  IF NOT has_schema_privilege('authenticated', 'public', 'USAGE')
     OR NOT has_type_privilege('authenticated', 'public.group_type', 'USAGE') THEN
    RAISE EXCEPTION 'Preflight authenticated lacks public-schema or group_type USAGE required by the RPC API';
  END IF;
  IF NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
     OR NOT has_function_privilege(current_user, 'public.is_active_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Preflight current role lacks EXECUTE on auth.uid() or is_active_account()';
  END IF;
  IF NOT (has_table_privilege(current_user, 'public.groups', 'INSERT')
          AND has_table_privilege(current_user, 'public.groups', 'SELECT'))
     OR NOT has_table_privilege(current_user, 'public.group_members', 'INSERT')
     OR NOT (has_table_privilege(current_user, 'public.expenses', 'SELECT')
             AND has_table_privilege(current_user, 'public.expenses', 'UPDATE'))
     OR NOT (has_table_privilege(current_user, 'public.expense_payers', 'SELECT')
             AND has_table_privilege(current_user, 'public.expense_payers', 'UPDATE'))
     OR NOT (has_table_privilege(current_user, 'public.expense_shares', 'SELECT')
             AND has_table_privilege(current_user, 'public.expense_shares', 'UPDATE'))
     OR NOT has_table_privilege(current_user, 'public.expense_items', 'SELECT') THEN
    RAISE EXCEPTION 'Preflight current role lacks table privileges required by function bodies';
  END IF;

  -- Require the active-account helper itself to use the expected caller-bound
  -- profile check and safe definer configuration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.is_active_account()'::regprocedure
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, auth, pg_temp', 'row_security=off']
      AND p.prosrc ILIKE '%auth.uid()%'
      AND p.prosrc ILIKE '%public.profiles%'
      AND p.prosrc ILIKE '%deleted_at%IS NULL%'
  ) THEN RAISE EXCEPTION 'Preflight is_active_account() definition/configuration is not the reviewed caller-bound helper'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'auth.uid()'::regprocedure AND p.prorettype = 'uuid'::regtype
  ) THEN RAISE EXCEPTION 'Preflight auth.uid() has an unexpected return type'; END IF;
  IF to_regprocedure('pg_catalog.hashtextextended(text,bigint)') IS NULL
     OR to_regprocedure('pg_catalog.pg_advisory_xact_lock(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Preflight missing advisory-lock/hash built-ins used by the edit RPC';
  END IF;

  -- The active-account helper is itself SECURITY DEFINER; validate its owner,
  -- not just the installer role, because it must read profiles with RLS enabled.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc helper
    JOIN pg_roles owner_role ON owner_role.oid = helper.proowner
    WHERE helper.oid = 'public.is_active_account()'::regprocedure
      AND (owner_role.rolsuper OR owner_role.rolbypassrls)
      AND has_table_privilege(owner_role.rolname, 'public.profiles', 'SELECT')
      AND has_function_privilege(owner_role.rolname, 'auth.uid()', 'EXECUTE')
  ) THEN RAISE EXCEPTION 'Preflight is_active_account() owner cannot safely read profiles and call auth.uid()'; END IF;

  -- No replacement of any unreviewed pre-existing function is allowed.
  IF to_regprocedure('public.create_group_with_owner(text,text,public.group_type)') IS NOT NULL
     OR to_regprocedure('public.update_expense_with_records(uuid,timestamp with time zone,text,bigint,date,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'A target RPC already exists; inspect its exact definition, owner and ACL before retrying';
  END IF;
END
$preflight$;

-- Frontend call: db.rpc('create_group_with_owner', ...)
CREATE FUNCTION public.create_group_with_owner(
  p_name TEXT,
  p_description TEXT,
  p_type public.group_type
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_group_id UUID;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80
    OR (p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 200)
    OR p_type IS NULL THEN
    RAISE EXCEPTION 'Group details are invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.groups (name, description, type, currency, creator_id)
  VALUES (pg_catalog.btrim(p_name), NULLIF(pg_catalog.btrim(p_description), ''), p_type, 'INR', v_user_id)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group_id, v_user_id, 'admin');

  RETURN v_group_id;
END;
$function$;

-- Frontend call: db.rpc('update_expense_with_records', ...)
CREATE FUNCTION public.update_expense_with_records(
  p_expense_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_title TEXT,
  p_amount_paise BIGINT,
  p_expense_date DATE,
  p_notes TEXT,
  p_category TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_payer_count BIGINT;
  v_payer_total NUMERIC;
  v_share_count BIGINT;
  v_share_total NUMERIC;
  v_pair_key TEXT;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_expense_id IS NULL OR p_expected_updated_at IS NULL
    OR p_title IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 1 AND 120
    OR p_amount_paise IS NULL OR p_amount_paise <= 0
    OR p_expense_date IS NULL
    OR (p_notes IS NOT NULL AND pg_catalog.char_length(p_notes) > 500)
    OR (p_category IS NOT NULL AND pg_catalog.char_length(p_category) > 80) THEN
    RAISE EXCEPTION 'Expense details are invalid' USING ERRCODE = '22023';
  END IF;

  -- Read participants without taking the expense row lock: settlement RPCs
  -- acquire pair advisory locks before settlement-row locks.
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id OR v_expense.status <> 'active' THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;
  IF v_expense.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Expense changed since it was opened; reload and retry'
      USING ERRCODE = '40001';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND v_expense.split_method <> 'equal' THEN
    RAISE EXCEPTION 'Only equal-split amounts can be recalculated automatically'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise AND EXISTS (
    SELECT 1 FROM public.expense_items AS item WHERE item.expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Itemized expense amounts must be edited with their line allocations'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(payer.amount_paise), 0)
  INTO v_payer_count, v_payer_total
  FROM public.expense_payers AS payer
  WHERE payer.expense_id = p_expense_id;
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(share.amount_paise), 0)
  INTO v_share_count, v_share_total
  FROM public.expense_shares AS share
  WHERE share.expense_id = p_expense_id;

  IF v_payer_count = 0 OR v_share_count = 0
    OR v_payer_total <> v_expense.amount_paise
    OR v_share_total <> v_expense.amount_paise THEN
    RAISE EXCEPTION 'Existing expense payer and share totals do not reconcile'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise THEN
    IF p_amount_paise < v_payer_count THEN
      RAISE EXCEPTION 'Updated total is too small to retain every payer'
        USING ERRCODE = '23514';
    END IF;

    -- Pair advisory locks, ordered by pair key, before the expense row lock.
    FOR v_pair_key IN
      SELECT DISTINCT
        LEAST(payer.user_id::TEXT, share.user_id::TEXT) || ':' ||
        GREATEST(payer.user_id::TEXT, share.user_id::TEXT) AS pair_key
      FROM public.expense_payers AS payer
      CROSS JOIN public.expense_shares AS share
      WHERE payer.expense_id = p_expense_id
        AND share.expense_id = p_expense_id
        AND payer.user_id <> share.user_id
      ORDER BY pair_key
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pair_key, 0));
    END LOOP;
  END IF;

  -- Re-read after pair locks so a concurrent edit cannot be overwritten.
  SELECT * INTO v_expense
  FROM public.expenses AS expense
  WHERE expense.id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND OR v_expense.creator_id <> v_user_id OR v_expense.status <> 'active' THEN
    RAISE EXCEPTION 'Active expense creator required' USING ERRCODE = '42501';
  END IF;
  IF v_expense.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Expense changed since it was opened; reload and retry'
      USING ERRCODE = '40001';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND v_expense.split_method <> 'equal' THEN
    RAISE EXCEPTION 'Only equal-split amounts can be recalculated automatically' USING ERRCODE = '22023';
  END IF;
  IF p_amount_paise <> v_expense.amount_paise AND EXISTS (
    SELECT 1 FROM public.expense_items AS item WHERE item.expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'Itemized expense amounts must be edited with their line allocations'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paise <> v_expense.amount_paise THEN
    WITH participants AS (
      SELECT
        share.id,
        pg_catalog.row_number() OVER (ORDER BY share.user_id) AS position,
        pg_catalog.count(*) OVER () AS participant_count
      FROM public.expense_shares AS share
      WHERE share.expense_id = p_expense_id
    )
    UPDATE public.expense_shares AS share
    SET amount_paise = (p_amount_paise / participants.participant_count)
      + CASE WHEN participants.position <= p_amount_paise % participants.participant_count THEN 1 ELSE 0 END,
      percentage = NULL,
      share_weight = NULL
    FROM participants
    WHERE share.id = participants.id;

    WITH raw_amounts AS (
      SELECT
        payer.id,
        payer.user_id,
        payer.amount_paise::NUMERIC * (p_amount_paise - v_payer_count)::NUMERIC
          / v_expense.amount_paise::NUMERIC AS exact_amount
      FROM public.expense_payers AS payer
      WHERE payer.expense_id = p_expense_id
    ),
    base_amounts AS (
      SELECT
        raw_amounts.id,
        raw_amounts.user_id,
        pg_catalog.floor(raw_amounts.exact_amount)::BIGINT AS base_amount,
        raw_amounts.exact_amount - pg_catalog.floor(raw_amounts.exact_amount) AS remainder
      FROM raw_amounts
    ),
    ranked_amounts AS (
      SELECT
        base_amounts.id,
        base_amounts.base_amount,
        pg_catalog.row_number() OVER (
          ORDER BY base_amounts.remainder DESC, base_amounts.user_id
        ) AS remainder_rank,
        pg_catalog.sum(base_amounts.base_amount) OVER () AS base_total
      FROM base_amounts
    )
    UPDATE public.expense_payers AS payer
    SET amount_paise = 1 + ranked_amounts.base_amount
      + CASE WHEN ranked_amounts.remainder_rank <= p_amount_paise - v_payer_count - ranked_amounts.base_total THEN 1 ELSE 0 END
    FROM ranked_amounts
    WHERE payer.id = ranked_amounts.id;
  END IF;

  UPDATE public.expenses AS expense
  SET title = pg_catalog.btrim(p_title),
      amount_paise = p_amount_paise,
      expense_date = p_expense_date,
      notes = NULLIF(pg_catalog.btrim(p_notes), ''),
      category = NULLIF(pg_catalog.btrim(p_category), '')
  WHERE expense.id = p_expense_id;

  RETURN p_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group_with_owner(TEXT, TEXT, public.group_type)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_with_owner(TEXT, TEXT, public.group_type)
  TO authenticated;
REVOKE ALL ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense_with_records(
  UUID, TIMESTAMPTZ, TEXT, BIGINT, DATE, TEXT, TEXT
) TO authenticated;

DO $postflight$
DECLARE
  v_oid OID;
BEGIN
  FOREACH v_oid IN ARRAY ARRAY[
    'public.create_group_with_owner(text,text,public.group_type)'::regprocedure::oid,
    'public.update_expense_with_records(uuid,timestamp with time zone,text,bigint,date,text,text)'::regprocedure::oid
  ] LOOP
    IF NOT (SELECT p.prosecdef
            AND p.proconfig @> ARRAY['search_path=pg_catalog, public, auth, pg_temp', 'row_security=off']
            AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
            FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'Postflight failed: function security settings or owner mismatch for %', v_oid::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Postflight failed: execute ACL mismatch for %', v_oid::regprocedure;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Postflight failed: PUBLIC retains EXECUTE on %', v_oid::regprocedure;
    END IF;
  END LOOP;
END
$postflight$;

-- Review these results before accepting the COMMIT below.
SELECT p.oid::regprocedure AS signature,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS settings,
       p.proacl AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
WHERE p.oid IN (
  'public.create_group_with_owner(text,text,public.group_type)'::regprocedure,
  'public.update_expense_with_records(uuid,timestamp with time zone,text,bigint,date,text,text)'::regprocedure
)
ORDER BY p.oid::regprocedure::text;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('groups','group_members','expenses','expense_payers','expense_shares','expense_items')
ORDER BY tablename, policyname;

-- This standalone script installs functions/grants only; it does not record a
-- migration version. COMMIT applies both RPCs atomically. Remove this COMMIT
-- only when testing a copy intended to be rolled back.
COMMIT;
