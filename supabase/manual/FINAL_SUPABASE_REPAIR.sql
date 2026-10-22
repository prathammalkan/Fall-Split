-- ============================================================================
-- Fall Split — consolidated forward repair for the EXISTING Supabase project
-- Target: qkmswepfvgguomfhmkvg / PostgreSQL 17 / public app schema only
--
-- REVIEW ARTIFACT ONLY. Executed on disposable PostgreSQL 17.11 with a test
-- Supabase Auth shim; NOT validated against a full Supabase or production clone.
-- This file does not initialize a fresh project and does not reconcile/repair
-- historical migration versions 001-012 or populate a migration ledger.
-- Never execute until the accompanying README's baseline, backup, staging,
-- project-identity, and API-maintenance prerequisites have been completed.
-- No application rows are intentionally inserted, updated, or deleted here.
-- No Auth identities, Supabase-managed schemas, or provider settings are changed.
--
-- A single explicit transaction is used. Any failed precondition, migration
-- statement, or postcondition must abort the transaction; do not remove BEGIN,
-- COMMIT, or the assertions to force execution. Dashboard/query timeouts may
-- end the request; inspect the database outcome before considering a retry.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '50s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- SECTION 0 — fail-closed existing-schema and one-time-application checks.
DO $preflight$
DECLARE
  v_required_tables TEXT[] := ARRAY[
    'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
    'expenses', 'expense_payers', 'expense_shares', 'expense_items',
    'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
    'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
  ];
  v_requirement RECORD;
  v_relation REGCLASS;
  v_column TEXT;
  v_policy_count INTEGER;
  v_fk_count INTEGER;
  v_other_auth_fk_count INTEGER;
  v_signature TEXT;
  v_result TEXT;
  v_expected_policy TEXT[];
  v_actual_policy_hash TEXT;
  v_expected_policies TEXT[][] := ARRAY[
    ['activity_log','activity_log_own','4e00674fadbb48c071a9d7e8cc133763'],
    ['expense_history','expense_history_participant_select','2f9fa88c24be994c25cdd05208079f03'],
    ['expense_item_allocations','item_alloc_creator_mutate','61ffa7b05635073a1e6c6c119f39cb7b'],
    ['expense_item_allocations','item_alloc_select','439b412adb5377d194db1987a80b3c40'],
    ['expense_items','expense_items_creator_mutate','696c41277e8cd94a88d051a39d512280'],
    ['expense_items','expense_items_select','a2ce1b08eaa75faee72e5661d9e256f2'],
    ['expense_payers','expense_payers_delete','bd913b8658818876fe7a9250790ea1c7'],
    ['expense_payers','expense_payers_insert','e24753b7eb65a8579047be6fd7f06d09'],
    ['expense_payers','expense_payers_select','8ad7805d9cf96f70f2d7f421093e7ff0'],
    ['expense_payers','expense_payers_update','a853d76de3345896ffaf2737aec8c0e5'],
    ['expense_shares','expense_shares_delete','5f05de0b70b1c8b5cc9a96f8c057c77a'],
    ['expense_shares','expense_shares_insert','a693f487dfe0da4db4862ae4350f4945'],
    ['expense_shares','expense_shares_select','da41965f481a8553167f00efe73e2929'],
    ['expense_shares','expense_shares_update','4f45b3c2b5ee8ed68ce37e07523a1bed'],
    ['expenses','expenses_creator_insert','83a860f5b73806fb6a4ffcf927c91a9a'],
    ['expenses','expenses_creator_update','3677e321dedca952946e18a8f1177a61'],
    ['expenses','expenses_participant_select','3402dba27810be6af1e58a639082b8e8'],
    ['friend_requests','friend_requests_insert','114650097e3d92b5befb241024f76e7c'],
    ['friend_requests','friend_requests_select','fc30dd7507887ee2de63fe4781d04210'],
    ['friend_requests','friend_requests_update','600a7d5bb0c7eec70b64543855850587'],
    ['group_members','group_members_admin_insert','d72c7864a2937484a70e8dacbea2d307'],
    ['group_members','group_members_admin_update','82abe5fb7733481d063188c64f9858c4'],
    ['group_members','group_members_member_select','00d29243ad37fb4596cfc30ea14aa018'],
    ['group_members','group_members_self_leave','a79e6104f7526bded6a6bf78134108cb'],
    ['groups','groups_admin_update','f06f29720b76e0806862f693a0961beb'],
    ['groups','groups_creator_insert','a7378e98903fd829e23d15c05b096b62'],
    ['groups','groups_member_select','dfe015cabc16a5f392b9b17d4a01d502'],
    ['idempotency_records','idempotency_own','fc06884283aade3eb9896be0172e2795'],
    ['invitation_tokens','invitation_tokens_own_crud','107d3802196f663f3f8c71aa0d786532'],
    ['notification_preferences','notification_prefs_own','70c6648bcf399474034b8d8d39f00cae'],
    ['notifications','notifications_own','bccfa983ecba63cfebbac4dfda9cb87f'],
    ['profiles','profiles_own_select','b71e10b5db9d26fea6984df66d902146'],
    ['profiles','profiles_own_update','c10195e636ae762d6dda2343e2b2da4c'],
    ['profiles','profiles_username_search','84ee074d5a78afb23f420a63910467fd'],
    ['push_subscriptions','push_subs_own','ecf5f1b325ad0fd7b1eeb900be4ef6ed'],
    ['settlements','settlements_parties_select','52fd017fa5cf7143a061e89d2708fb90']
  ];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong execution role; open the verified project SQL Editor as postgres';
  END IF;
  IF current_setting('server_version_num')::INTEGER < 170000
     OR current_setting('server_version_num')::INTEGER >= 180000 THEN
    RAISE EXCEPTION 'This reviewed repair requires PostgreSQL 17';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase Auth objects/roles are missing';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'A migration ledger now exists; stop and reconcile it before using this manual repair';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
      WHERE schema.nspname = 'public' AND relation.relkind IN ('r','p')
        AND relation.relname = ANY (v_required_tables)) <> 17 THEN
    RAISE EXCEPTION 'Expected the audited set of 17 existing Fall Split application tables';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_required_tables) AS expected(table_name)
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', expected.table_name))
    WHERE relation.oid IS NULL OR NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'An expected application table is missing or has RLS disabled';
  END IF;

-- Required columns used by forward migrations 013-018 and the two timestamped
-- forward fixes; incompatible schemas stop here.
  FOR v_requirement IN
    SELECT * FROM (VALUES
      ('profiles', ARRAY['id','username','display_name','avatar_url','bio','upi_id','created_at','updated_at','deleted_at']::TEXT[]),
      ('friend_requests', ARRAY['id','sender_id','receiver_id','status','created_at','updated_at']::TEXT[]),
      ('invitation_tokens', ARRAY['id','token','type','creator_id','target_id','max_uses','use_count','expires_at','created_at','revoked_at']::TEXT[]),
      ('groups', ARRAY['id','name','description','type','currency','creator_id','archived_at','created_at','updated_at']::TEXT[]),
      ('group_members', ARRAY['id','group_id','user_id','role','invited_by','joined_at','removed_at']::TEXT[]),
      ('expenses', ARRAY['id','title','amount_paise','currency','split_method','group_id','creator_id','expense_date','category','notes','status','idempotency_key','voided_at','voided_by','void_reason','created_at','updated_at']::TEXT[]),
      ('expense_payers', ARRAY['id','expense_id','user_id','amount_paise']::TEXT[]),
      ('expense_shares', ARRAY['id','expense_id','user_id','amount_paise','percentage','share_weight']::TEXT[]),
      ('expense_items', ARRAY['id','expense_id','name','quantity','unit_price_paise','total_paise','sort_order']::TEXT[]),
      ('expense_item_allocations', ARRAY['id','item_id','user_id','amount_paise']::TEXT[]),
      ('expense_history', ARRAY['id','expense_id','changed_by','change_type']::TEXT[]),
      ('settlements', ARRAY['id','payer_id','recipient_id','amount_paise','currency','group_id','status','idempotency_key','confirmed_at','rejected_at','cancelled_at']::TEXT[]),
      ('notifications', ARRAY['user_id']::TEXT[]),
      ('notification_preferences', ARRAY['user_id','updated_at']::TEXT[]),
      ('push_subscriptions', ARRAY['user_id']::TEXT[]),
      ('idempotency_records', ARRAY['key','user_id','operation','result_id','expires_at']::TEXT[]),
      ('activity_log', ARRAY['user_id','actor_id']::TEXT[])
    ) AS required(table_name, column_names)
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('public.%I', v_requirement.table_name));
    FOREACH v_column IN ARRAY v_requirement.column_names LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = v_relation
          AND attribute.attname = v_column
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ) THEN
        RAISE EXCEPTION 'Incompatible schema: public.% is missing column %', v_requirement.table_name, v_column;
      END IF;
    END LOOP;
  END LOOP;

  -- Verify the complete audited pre-repair policy definitions. The fingerprint
  -- covers schema/table/name, command, permissive mode, role list, USING, and
  -- WITH CHECK as rendered by PostgreSQL 17. Any drift fails closed.
  SELECT count(*) INTO v_policy_count
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
  WHERE schema.nspname = 'public' AND relation.relname = ANY(v_required_tables);
  IF v_policy_count <> 36 THEN
    RAISE EXCEPTION 'Expected 36 audited baseline policies; found %. Reconcile policy drift first', v_policy_count;
  END IF;
  FOREACH v_expected_policy SLICE 1 IN ARRAY v_expected_policies LOOP
    SELECT md5(concat_ws(E'\x1f', schema.nspname, relation.relname, policy.polname,
      policy.polcmd::TEXT, policy.polpermissive::TEXT,
      COALESCE((
        SELECT string_agg(CASE WHEN role_oid = 0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(role_oid) END, ','
          ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(role_oid) END)
        FROM unnest(policy.polroles) AS role_oid
      ), ''),
      COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '<NULL>'),
      COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '<NULL>')
    )) INTO v_actual_policy_hash
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relname = v_expected_policy[1]
      AND policy.polname = v_expected_policy[2];
    IF v_actual_policy_hash IS DISTINCT FROM v_expected_policy[3] THEN
      RAISE EXCEPTION 'Audited baseline policy definition drift: public.%.%', v_expected_policy[1], v_expected_policy[2];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
      WHERE schema.nspname = 'public'
        AND relation.relname = v_expected_policy[1]
        AND policy.polname = v_expected_policy[2]
    ) THEN
      RAISE EXCEPTION 'Expected audited baseline policy public.%.% is missing', v_expected_policy[1], v_expected_policy[2];
    END IF;
  END LOOP;

  -- The scripts rename these legacy RPCs. Signatures/results and owner are part of the baseline contract.
  FOR v_signature, v_result IN
    SELECT * FROM (VALUES
      ('public.accept_invitation(text)', 'jsonb'),
      ('public.are_friends(uuid,uuid)', 'boolean'),
      ('public.can_access_expense(uuid,uuid)', 'boolean'),
      ('public.cancel_settlement(uuid)', 'uuid'),
      ('public.delete_account()', 'json'),
      ('public.get_friend_balances()', 'TABLE(other_user_id uuid, net_paise bigint, owed_to_paise bigint, owing_paise bigint)'),
      ('public.get_group_balances(uuid)', 'TABLE(other_user_id uuid, net_paise bigint, owed_to_paise bigint, owing_paise bigint)'),
      ('public.get_invitation_preview(text)', 'jsonb'),
      ('public.propose_settlement(uuid,bigint,text)', 'uuid'),
      ('public.respond_to_settlement(uuid,text)', 'uuid')
    ) AS expected(signature, result_type)
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required existing function % is missing', v_signature;
    END IF;
    IF (SELECT pg_catalog.pg_get_function_result(to_regprocedure(v_signature))) <> v_result THEN
      RAISE EXCEPTION 'Unexpected return type for existing function %', v_signature;
    END IF;
    IF (SELECT function_row.proowner
        FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid = to_regprocedure(v_signature)) <> to_regrole('postgres') THEN
      RAISE EXCEPTION 'Existing function % has an unexpected owner', v_signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.handle_new_user()') IS NULL
     OR to_regprocedure('public.prevent_settlement_history_mutation()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'auth.users'::regclass
         AND trigger_row.tgname = 'on_auth_user_created'
         AND NOT trigger_row.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.settlements'::regclass
         AND trigger_row.tgname = 'settlement_history_immutable'
         AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION 'Required Auth signup or immutable-settlement trigger baseline is missing';
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.confrelid = 'auth.users'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.confdeltype = 'c';
  SELECT count(*) INTO v_other_auth_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.connamespace = 'public'::regnamespace
    AND constraint_row.confrelid = 'auth.users'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.conrelid <> 'public.profiles'::regclass;
  IF v_fk_count <> 1 OR v_other_auth_fk_count <> 0 THEN
    RAISE EXCEPTION 'Auth/profile FK baseline differs from the audited retention-migration assumptions';
  END IF;

  IF to_regprocedure('public.is_active_account()') IS NOT NULL
     OR to_regprocedure('public.leave_group(uuid)') IS NOT NULL
     OR to_regprocedure('public.get_profile_for_user(uuid)') IS NOT NULL
     OR to_regprocedure('public.get_settlement_recipient_upis()') IS NOT NULL
     OR to_regprocedure('public.expense_pair_allocations(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.create_expense_with_records(jsonb,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.create_itemized_expense_with_records(jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.get_profile_for_user_internal(uuid)') IS NOT NULL
     OR to_regprocedure('public.get_settlement_recipient_upis_internal()') IS NOT NULL
     OR to_regprocedure('public.get_friend_balances_internal()') IS NOT NULL
     OR to_regprocedure('public.get_group_balances_internal(uuid)') IS NOT NULL
     OR to_regprocedure('public.accept_invitation_internal(text)') IS NOT NULL
     OR to_regprocedure('public.propose_settlement_internal(uuid,bigint,text)') IS NOT NULL
     OR to_regprocedure('public.respond_to_settlement_internal(uuid,text)') IS NOT NULL
     OR to_regprocedure('public.cancel_settlement_internal(uuid)') IS NOT NULL
     OR to_regprocedure('public.enforce_active_account_write()') IS NOT NULL
     OR to_regprocedure('public.enforce_invitation_token_integrity()') IS NOT NULL
     OR to_regclass('public.discoverable_profiles') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
       JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
       JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
       WHERE schema.nspname = 'public'
         AND trigger_row.tgname IN ('active_account_write_guard','invitation_token_integrity')
         AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION 'Forward-repair objects already exist; this script is one-shot and must not be rerun';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expense_items
    GROUP BY expense_id, sort_order HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate item sort orders exist within an expense; reconcile before adding the unique index';
  END IF;
  IF EXISTS (
    SELECT expense.id
    FROM public.expenses AS expense
    LEFT JOIN LATERAL (
      SELECT count(*) AS row_count, coalesce(sum(payer.amount_paise), 0) AS total
      FROM public.expense_payers AS payer
      WHERE payer.expense_id = expense.id
    ) AS payer_totals ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS row_count, coalesce(sum(share.amount_paise), 0) AS total
      FROM public.expense_shares AS share
      WHERE share.expense_id = expense.id
    ) AS share_totals ON TRUE
    WHERE expense.status = 'active'
      AND (payer_totals.row_count = 0 OR share_totals.row_count = 0
        OR payer_totals.total <> expense.amount_paise
        OR share_totals.total <> expense.amount_paise)
  ) THEN
    RAISE EXCEPTION 'Existing active expense payer/share totals do not reconcile; repair data before schema rollout';
  END IF;
  IF EXISTS (
    SELECT expense.id
    FROM public.expenses AS expense
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(item.total_paise), 0) AS total
      FROM public.expense_items AS item
      WHERE item.expense_id = expense.id
    ) AS item_totals ON TRUE
    WHERE expense.status = 'active'
      AND expense.split_method = 'itemized'
      AND item_totals.total <> expense.amount_paise
  ) THEN
    RAISE EXCEPTION 'Existing active itemized expense lines do not reconcile; repair data before schema rollout';
  END IF;
  IF EXISTS (
    SELECT item.id
    FROM public.expense_items AS item
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(allocation.amount_paise), 0) AS total
      FROM public.expense_item_allocations AS allocation
      WHERE allocation.item_id = item.id
    ) AS allocation_totals ON TRUE
    WHERE allocation_totals.total <> item.total_paise
  ) THEN
    RAISE EXCEPTION 'Existing item allocations do not reconcile to their line totals; repair data before schema rollout';
  END IF;
  IF EXISTS (
    WITH item_totals AS (
      SELECT allocation_user.user_id, allocation_user.expense_id, sum(allocation_user.amount_paise) AS amount_paise
      FROM (
        SELECT item.expense_id, allocation.user_id, allocation.amount_paise
        FROM public.expense_items AS item
        JOIN public.expense_item_allocations AS allocation ON allocation.item_id = item.id
      ) AS allocation_user
      JOIN public.expenses AS item ON item.id = allocation_user.expense_id
      WHERE item.status = 'active' AND item.split_method = 'itemized'
      GROUP BY allocation_user.expense_id, allocation_user.user_id
    ), share_totals AS (
      SELECT share.expense_id, share.user_id, sum(share.amount_paise) AS amount_paise
      FROM public.expense_shares AS share
      JOIN public.expenses AS expense ON expense.id = share.expense_id
      WHERE expense.status = 'active' AND expense.split_method = 'itemized'
      GROUP BY share.expense_id, share.user_id
    )
    SELECT 1 FROM item_totals
    FULL OUTER JOIN share_totals USING (expense_id, user_id)
    WHERE item_totals.amount_paise IS DISTINCT FROM share_totals.amount_paise
  ) THEN
    RAISE EXCEPTION 'Existing item allocations do not reconcile to participant shares; repair data before schema rollout';
  END IF;
  IF to_regclass('public.idx_expense_items_expense_sort_order') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index AS index_row
       JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
       WHERE index_relation.oid = pg_catalog.to_regclass('public.idx_expense_items_expense_sort_order')
         AND index_row.indisunique AND index_row.indisvalid
         AND pg_catalog.pg_get_indexdef(index_row.indexrelid) ILIKE '%(expense_id, sort_order)%'
     ) THEN
    RAISE EXCEPTION 'The item-sort index name exists with a different/invalid definition; review it manually';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relkind = 'S'
  ) THEN
    RAISE EXCEPTION 'Unexpected public sequences exist; review their privileges before repair';
  END IF;
END;
$preflight$;

-- ============================================================================
-- SECTION: 013_security_financial_reconciliation.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
-- Forward-only reconciliation for audited Fall Split environments.
-- Do not mark migrations 001-012 as applied based on object presence alone:
-- no repository migration ledger was found during the read-only audit.

-- A member may leave only through this narrow operation; the direct UPDATE
-- policy allowed the member to change their own role before this migration.
DROP POLICY IF EXISTS "group_members_self_leave" ON public.group_members;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
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

-- Replace broad profile row access with a public-safe discoverability view and
-- a caller-bound RPC for own/friend profile details.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (id, username, display_name, avatar_url, bio, upi_id, created_at, updated_at, deleted_at)
  ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (id, username, display_name, avatar_url, bio, upi_id, created_at, updated_at, deleted_at)
  ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, display_name, avatar_url)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username, display_name, bio, upi_id)
  ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE VIEW public.discoverable_profiles
WITH (security_invoker = true)
AS
  SELECT id, username, display_name, avatar_url
  FROM public.profiles;

GRANT SELECT ON public.discoverable_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_for_user(p_user_id UUID)
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
SET search_path = pg_catalog, public, pg_temp
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
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.deleted_at IS NULL
    AND auth.uid() IS NOT NULL
    AND (
      profile.id = auth.uid()
      OR public.are_friends(auth.uid(), profile.id)
    );
$function$;

REVOKE ALL ON FUNCTION public.get_profile_for_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_settlement_recipient_upis()
RETURNS TABLE (settlement_id UUID, upi_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT settlement.id, profile.upi_id
  FROM public.settlements AS settlement
  JOIN public.profiles AS profile ON profile.id = settlement.recipient_id
  WHERE settlement.payer_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND settlement.status IN ('proposed', 'pending')
    AND profile.deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settlement_recipient_upis() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_account()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    deleted_at = pg_catalog.now(),
    display_name = '[Deleted User]',
    username = 'deleted_' || pg_catalog.substring(v_user_id::TEXT, 1, 8),
    avatar_url = NULL,
    bio = NULL,
    upi_id = NULL,
    updated_at = pg_catalog.now()
  WHERE id = v_user_id
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Account profile not found' USING ERRCODE = 'P0002';
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

  RETURN pg_catalog.json_build_object('success', TRUE);
END;
$function$;

-- Allocate proportional integer-paise shares with controlled rounding. The
-- augmenting-path pass preserves both participant totals and payer totals.
CREATE OR REPLACE FUNCTION public.expense_pair_allocations(p_user_id UUID, p_group_id UUID)
RETURNS TABLE (
  expense_id UUID,
  group_id UUID,
  payer_id UUID,
  participant_id UUID,
  amount_paise BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expense RECORD;
  v_payer_ids UUID[];
  v_payer_amounts BIGINT[];
  v_participant_ids UUID[];
  v_participant_shares BIGINT[];
  v_base BIGINT[][];
  v_remainders NUMERIC[][];
  v_selected BOOLEAN[][];
  v_row_remaining INTEGER[];
  v_column_remaining INTEGER[];
  v_parent INTEGER[];
  v_queue INTEGER[];
  v_node_count INTEGER;
  v_payer_count INTEGER;
  v_participant_count INTEGER;
  v_total_paid BIGINT;
  v_total_shares BIGINT;
  v_row_base BIGINT;
  v_column_base BIGINT;
  v_numerator NUMERIC;
  v_start_row INTEGER;
  v_head INTEGER;
  v_node INTEGER;
  v_candidate INTEGER;
  v_column_node INTEGER;
  v_row_node INTEGER;
  v_previous_column_node INTEGER;
  v_endpoint INTEGER;
  v_i INTEGER;
  v_j INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_expense IN
    SELECT expense.id, expense.group_id, expense.amount_paise
    FROM public.expenses AS expense
    WHERE expense.status = 'active'
      AND (p_group_id IS NULL OR expense.group_id = p_group_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.expense_payers AS payer
          WHERE payer.expense_id = expense.id AND payer.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.expense_shares AS share
          WHERE share.expense_id = expense.id AND share.user_id = p_user_id
        )
      )
    ORDER BY expense.id
  LOOP
    SELECT
      pg_catalog.array_agg(payer.user_id ORDER BY payer.user_id),
      pg_catalog.array_agg(payer.amount_paise ORDER BY payer.user_id),
      pg_catalog.sum(payer.amount_paise)
    INTO v_payer_ids, v_payer_amounts, v_total_paid
    FROM public.expense_payers AS payer
    WHERE payer.expense_id = v_expense.id;

    SELECT
      pg_catalog.array_agg(share.user_id ORDER BY share.user_id),
      pg_catalog.array_agg(share.amount_paise ORDER BY share.user_id),
      pg_catalog.sum(share.amount_paise)
    INTO v_participant_ids, v_participant_shares, v_total_shares
    FROM public.expense_shares AS share
    WHERE share.expense_id = v_expense.id;

    IF v_payer_ids IS NULL OR v_participant_ids IS NULL
      OR v_total_paid IS NULL OR v_total_shares IS NULL THEN
      RAISE EXCEPTION 'Active expense % is missing payers or participant shares', v_expense.id
        USING ERRCODE = '23514';
    END IF;

    IF v_total_paid <= 0
      OR v_total_paid <> v_total_shares
      OR v_total_paid <> v_expense.amount_paise THEN
      RAISE EXCEPTION 'Active expense % payer, share, and total amounts do not reconcile', v_expense.id
        USING ERRCODE = '23514';
    END IF;

    v_payer_count := pg_catalog.array_length(v_payer_ids, 1);
    v_participant_count := pg_catalog.array_length(v_participant_ids, 1);
    v_node_count := v_payer_count + v_participant_count;
    v_base := pg_catalog.array_fill(0::BIGINT, ARRAY[v_participant_count, v_payer_count]);
    v_remainders := pg_catalog.array_fill(0::NUMERIC, ARRAY[v_participant_count, v_payer_count]);
    v_selected := pg_catalog.array_fill(FALSE, ARRAY[v_participant_count, v_payer_count]);
    v_row_remaining := pg_catalog.array_fill(0, ARRAY[v_participant_count]);
    v_column_remaining := pg_catalog.array_fill(0, ARRAY[v_payer_count]);

    FOR v_i IN 1..v_participant_count LOOP
      v_row_base := 0;
      FOR v_j IN 1..v_payer_count LOOP
        v_numerator := v_participant_shares[v_i]::NUMERIC * v_payer_amounts[v_j]::NUMERIC;
        v_base[v_i][v_j] := pg_catalog.floor(v_numerator / v_total_paid)::BIGINT;
        v_remainders[v_i][v_j] := pg_catalog.mod(v_numerator, v_total_paid::NUMERIC);
        v_row_base := v_row_base + v_base[v_i][v_j];
      END LOOP;
      v_row_remaining[v_i] := (v_participant_shares[v_i] - v_row_base)::INTEGER;
    END LOOP;

    FOR v_j IN 1..v_payer_count LOOP
      v_column_base := 0;
      FOR v_i IN 1..v_participant_count LOOP
        v_column_base := v_column_base + v_base[v_i][v_j];
      END LOOP;
      v_column_remaining[v_j] := (v_payer_amounts[v_j] - v_column_base)::INTEGER;
    END LOOP;

    -- Find a deterministic augmenting path for each residual paise. This
    -- controlled rounding preserves both participant-share and payer totals.
    FOR v_start_row IN 1..v_participant_count LOOP
      WHILE v_row_remaining[v_start_row] > 0 LOOP
        v_parent := pg_catalog.array_fill(0, ARRAY[v_node_count]);
        v_queue := ARRAY[v_start_row];
        v_parent[v_start_row] := -1;
        v_head := 1;
        v_endpoint := 0;

        WHILE v_head <= pg_catalog.cardinality(v_queue) AND v_endpoint = 0 LOOP
          v_node := v_queue[v_head];
          v_head := v_head + 1;

          IF v_node <= v_participant_count THEN
            FOR v_candidate IN
              SELECT candidate.idx
              FROM pg_catalog.generate_series(1, v_payer_count) AS candidate(idx)
              ORDER BY v_remainders[v_node][candidate.idx] DESC, v_payer_ids[candidate.idx]
            LOOP
              v_column_node := v_participant_count + v_candidate;
              IF v_remainders[v_node][v_candidate] > 0
                AND NOT v_selected[v_node][v_candidate]
                AND v_parent[v_column_node] = 0 THEN
                v_parent[v_column_node] := v_node;
                v_queue := pg_catalog.array_append(v_queue, v_column_node);
                IF v_column_remaining[v_candidate] > 0 THEN
                  v_endpoint := v_column_node;
                  EXIT;
                END IF;
              END IF;
            END LOOP;
          ELSE
            v_j := v_node - v_participant_count;
            FOR v_candidate IN 1..v_participant_count LOOP
              IF v_selected[v_candidate][v_j] AND v_parent[v_candidate] = 0 THEN
                v_parent[v_candidate] := v_node;
                v_queue := pg_catalog.array_append(v_queue, v_candidate);
              END IF;
            END LOOP;
          END IF;
        END LOOP;

        IF v_endpoint = 0 THEN
          RAISE EXCEPTION 'Could not reconcile integer-paise allocation for expense %', v_expense.id
            USING ERRCODE = '23514';
        END IF;

        v_column_node := v_endpoint;
        LOOP
          v_row_node := v_parent[v_column_node];
          v_j := v_column_node - v_participant_count;
          v_selected[v_row_node][v_j] := TRUE;
          IF v_row_node = v_start_row THEN
            EXIT;
          END IF;
          v_previous_column_node := v_parent[v_row_node];
          v_selected[v_row_node][v_previous_column_node - v_participant_count] := FALSE;
          v_column_node := v_previous_column_node;
        END LOOP;

        v_row_remaining[v_start_row] := v_row_remaining[v_start_row] - 1;
        v_column_remaining[v_endpoint - v_participant_count]
          := v_column_remaining[v_endpoint - v_participant_count] - 1;
      END LOOP;
    END LOOP;

    FOR v_j IN 1..v_payer_count LOOP
      IF v_column_remaining[v_j] <> 0 THEN
        RAISE EXCEPTION 'Could not reconcile payer totals for expense %', v_expense.id
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    FOR v_i IN 1..v_participant_count LOOP
      FOR v_j IN 1..v_payer_count LOOP
        expense_id := v_expense.id;
        group_id := v_expense.group_id;
        payer_id := v_payer_ids[v_j];
        participant_id := v_participant_ids[v_i];
        amount_paise := v_base[v_i][v_j] + CASE WHEN v_selected[v_i][v_j] THEN 1 ELSE 0 END;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.expense_pair_allocations(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_friend_balances()
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH caller AS (SELECT auth.uid() AS uid),
  allocations AS MATERIALIZED (
    SELECT allocation.*
    FROM public.expense_pair_allocations((SELECT uid FROM caller), NULL::UUID) AS allocation
  ),
  flows AS (
    SELECT
      allocation.participant_id AS other_user,
      allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.payer_id = (SELECT uid FROM caller)
      AND allocation.participant_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT
      allocation.payer_id AS other_user,
      -allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.participant_id = (SELECT uid FROM caller)
      AND allocation.payer_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT settlement.recipient_id, settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.payer_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'

    UNION ALL

    SELECT settlement.payer_id, -settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.recipient_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
  ),
  aggregated AS (
    SELECT flow.other_user, pg_catalog.sum(flow.net)::BIGINT AS balance
    FROM flows AS flow
    WHERE flow.other_user IS NOT NULL
    GROUP BY flow.other_user
    HAVING pg_catalog.sum(flow.net) <> 0
  )
  SELECT
    aggregate.other_user,
    aggregate.balance,
    CASE WHEN aggregate.balance > 0 THEN aggregate.balance ELSE 0 END::BIGINT,
    CASE WHEN aggregate.balance < 0 THEN -aggregate.balance ELSE 0 END::BIGINT
  FROM aggregated AS aggregate;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_balances(p_group_id UUID)
RETURNS TABLE (
  other_user_id UUID,
  net_paise BIGINT,
  owed_to_paise BIGINT,
  owing_paise BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  WITH caller AS (
    SELECT auth.uid() AS uid
    WHERE auth.uid() IS NOT NULL
      AND public.is_group_member(auth.uid(), p_group_id)
  ),
  allocations AS MATERIALIZED (
    SELECT allocation.*
    FROM public.expense_pair_allocations((SELECT uid FROM caller), p_group_id) AS allocation
  ),
  flows AS (
    SELECT
      allocation.participant_id AS other_user,
      allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.group_id = p_group_id
      AND allocation.payer_id = (SELECT uid FROM caller)
      AND allocation.participant_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT
      allocation.payer_id AS other_user,
      -allocation.amount_paise AS net
    FROM allocations AS allocation
    WHERE allocation.group_id = p_group_id
      AND allocation.participant_id = (SELECT uid FROM caller)
      AND allocation.payer_id <> (SELECT uid FROM caller)

    UNION ALL

    SELECT settlement.recipient_id, settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.payer_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
      AND settlement.group_id = p_group_id

    UNION ALL

    SELECT settlement.payer_id, -settlement.amount_paise
    FROM public.settlements AS settlement
    WHERE settlement.recipient_id = (SELECT uid FROM caller)
      AND settlement.status = 'confirmed'
      AND settlement.group_id = p_group_id
  ),
  aggregated AS (
    SELECT flow.other_user, pg_catalog.sum(flow.net)::BIGINT AS balance
    FROM flows AS flow
    WHERE flow.other_user IS NOT NULL
    GROUP BY flow.other_user
    HAVING pg_catalog.sum(flow.net) <> 0
  )
  SELECT
    aggregate.other_user,
    aggregate.balance,
    CASE WHEN aggregate.balance > 0 THEN aggregate.balance ELSE 0 END::BIGINT,
    CASE WHEN aggregate.balance < 0 THEN -aggregate.balance ELSE 0 END::BIGINT
  FROM aggregated AS aggregate;
$function$;

-- Internal helper/access RPCs are not directly exposed to anonymous callers.
-- Invitation preview is deliberately public and returns only approved fields.
-- Bind relationship/access helper IDs to the caller so the interval before
-- migration 014 cannot be used as an arbitrary-ID relationship probe.
CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND user_a = auth.uid()
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
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
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
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
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
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
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

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_group_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_group_admin(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_expense(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_friend_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_group_balances(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_settlement_recipient_upis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_account() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_settlement(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_settlement(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_expense(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_balances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settlement_recipient_upis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_settlement(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_settlement(UUID) TO authenticated;

ALTER FUNCTION public.are_friends(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.is_group_member(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.is_group_admin(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.can_access_expense(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.accept_invitation(TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_invitation_preview(TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.delete_account() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.propose_settlement(UUID, BIGINT, TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.respond_to_settlement(UUID, TEXT) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.cancel_settlement(UUID) SET search_path = pg_catalog, public, pg_temp;

-- ============================================================================
-- SECTION: 014_active_account_enforcement.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
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

-- ============================================================================
-- SECTION: 015_relationship_authorization.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
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

-- ============================================================================
-- SECTION: 016_atomic_expense_creation.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
-- Create or reconcile an expense and its payer/share ledger in one transaction.
-- A retry with the same key repairs missing rows, but never overwrites conflicting
-- records or treats the expense header alone as proof of completion.
CREATE OR REPLACE FUNCTION public.create_expense_with_records(
  p_expense JSONB,
  p_payers JSONB,
  p_shares JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_creator_id UUID;
  v_idempotency_key TEXT;
  v_title TEXT;
  v_amount_paise BIGINT;
  v_currency TEXT;
  v_split_method public.split_method;
  v_group_id UUID;
  v_expense_date DATE;
  v_category TEXT;
  v_notes TEXT;
  v_expense public.expenses%ROWTYPE;
  v_expense_id UUID;
  v_payer_count BIGINT;
  v_payer_user_count BIGINT;
  v_payer_distinct_user_count BIGINT;
  v_payer_amount_count BIGINT;
  v_payer_total NUMERIC;
  v_share_count BIGINT;
  v_share_user_count BIGINT;
  v_share_distinct_user_count BIGINT;
  v_share_amount_count BIGINT;
  v_share_total NUMERIC;
  v_persisted_payer_count BIGINT;
  v_persisted_payer_total NUMERIC;
  v_persisted_share_count BIGINT;
  v_persisted_share_total NUMERIC;
  v_restore_voided BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_account() THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_expense) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_payers) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(p_shares) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expense, payer, and share payloads have invalid shapes' USING ERRCODE = '22023';
  END IF;

  v_creator_id := (p_expense->>'creator_id')::UUID;
  v_idempotency_key := pg_catalog.btrim(p_expense->>'idempotency_key');
  v_title := pg_catalog.btrim(p_expense->>'title');
  v_amount_paise := (p_expense->>'amount_paise')::BIGINT;
  v_currency := p_expense->>'currency';
  v_split_method := (p_expense->>'split_method')::public.split_method;
  v_group_id := NULLIF(p_expense->>'group_id', '')::UUID;
  v_expense_date := (p_expense->>'expense_date')::DATE;
  v_category := NULLIF(p_expense->>'category', 'null');
  v_notes := NULLIF(p_expense->>'notes', 'null');

  IF v_creator_id IS NULL OR v_creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Expense creator must be the authenticated user' USING ERRCODE = '42501';
  END IF;
  IF v_idempotency_key IS NULL OR pg_catalog.char_length(v_idempotency_key) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'A valid expense idempotency key is required' USING ERRCODE = '22023';
  END IF;
  IF v_title IS NULL OR pg_catalog.char_length(v_title) NOT BETWEEN 1 AND 120
    OR v_amount_paise IS NULL OR v_amount_paise <= 0
    OR v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$'
    OR v_split_method IS NULL OR v_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense details are invalid' USING ERRCODE = '22023';
  END IF;
  IF v_group_id IS NOT NULL AND NOT public.is_group_member(v_user_id, v_group_id) THEN
    RAISE EXCEPTION 'Active group membership required to create this expense' USING ERRCODE = '42501';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(payer."userId"),
    pg_catalog.count(DISTINCT payer."userId"),
    pg_catalog.count(payer."amountPaise"),
    COALESCE(pg_catalog.sum(payer."amountPaise"), 0)
  INTO v_payer_count, v_payer_user_count, v_payer_distinct_user_count, v_payer_amount_count, v_payer_total
  FROM pg_catalog.jsonb_to_recordset(p_payers) AS payer("userId" UUID, "amountPaise" BIGINT);

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(share."userId"),
    pg_catalog.count(DISTINCT share."userId"),
    pg_catalog.count(share."amountPaise"),
    COALESCE(pg_catalog.sum(share."amountPaise"), 0)
  INTO v_share_count, v_share_user_count, v_share_distinct_user_count, v_share_amount_count, v_share_total
  FROM pg_catalog.jsonb_to_recordset(p_shares) AS share("userId" UUID, "amountPaise" BIGINT);

  IF v_payer_count = 0 OR v_payer_user_count <> v_payer_count
    OR v_payer_distinct_user_count <> v_payer_count
    OR v_payer_amount_count <> v_payer_count OR v_payer_total <> v_amount_paise
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_payers) AS payer("amountPaise" BIGINT)
      WHERE payer."amountPaise" <= 0
    ) THEN
    RAISE EXCEPTION 'Payer contributions must be unique, positive, and equal the expense total'
      USING ERRCODE = '23514';
  END IF;
  IF v_share_count = 0 OR v_share_user_count <> v_share_count
    OR v_share_distinct_user_count <> v_share_count
    OR v_share_amount_count <> v_share_count OR v_share_total <> v_amount_paise
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(p_shares) AS share("amountPaise" BIGINT)
      WHERE share."amountPaise" < 0
    ) THEN
    RAISE EXCEPTION 'Participant shares must be unique, non-negative, and equal the expense total'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idempotency_key, 0));

  SELECT *
  INTO v_expense
  FROM public.expenses
  WHERE idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_expense.creator_id <> v_creator_id
      OR v_expense.title IS DISTINCT FROM v_title
      OR v_expense.amount_paise IS DISTINCT FROM v_amount_paise
      OR v_expense.currency IS DISTINCT FROM v_currency
      OR v_expense.split_method IS DISTINCT FROM v_split_method
      OR v_expense.group_id IS DISTINCT FROM v_group_id
      OR v_expense.expense_date IS DISTINCT FROM v_expense_date
      OR v_expense.category IS DISTINCT FROM v_category
      OR v_expense.notes IS DISTINCT FROM v_notes THEN
      RAISE EXCEPTION 'Expense idempotency key was already used for different details'
        USING ERRCODE = '22023';
    END IF;
    IF v_expense.status = 'voided' AND v_expense.void_reason = 'Payers/shares insert failed' THEN
      v_restore_voided := TRUE;
    ELSIF v_expense.status <> 'active' THEN
      RAISE EXCEPTION 'Expense exists in a non-active state and requires manual reconciliation'
        USING ERRCODE = '22023';
    END IF;
    v_expense_id := v_expense.id;
  ELSE
    INSERT INTO public.expenses (
      title, amount_paise, currency, split_method, group_id, creator_id,
      expense_date, category, notes, idempotency_key
    )
    VALUES (
      v_title, v_amount_paise, v_currency, v_split_method, v_group_id, v_creator_id,
      v_expense_date, v_category, v_notes, v_idempotency_key
    )
    RETURNING id INTO v_expense_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_payers AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_payers)
      AS expected("userId" UUID, "amountPaise" BIGINT)
      ON expected."userId" = existing.user_id
    WHERE existing.expense_id = v_expense_id
      AND (expected."userId" IS NULL OR expected."amountPaise" IS DISTINCT FROM existing.amount_paise)
  ) THEN
    RAISE EXCEPTION 'Existing payer records conflict with the retry payload' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.expense_payers (expense_id, user_id, amount_paise)
  SELECT v_expense_id, expected."userId", expected."amountPaise"
  FROM pg_catalog.jsonb_to_recordset(p_payers) AS expected("userId" UUID, "amountPaise" BIGINT)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_payers AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  IF EXISTS (
    SELECT 1
    FROM public.expense_shares AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_shares)
      AS expected("userId" UUID, "amountPaise" BIGINT)
      ON expected."userId" = existing.user_id
    WHERE existing.expense_id = v_expense_id
      AND (expected."userId" IS NULL OR expected."amountPaise" IS DISTINCT FROM existing.amount_paise)
  ) THEN
    RAISE EXCEPTION 'Existing participant-share records conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.expense_shares (expense_id, user_id, amount_paise, percentage, share_weight)
  SELECT
    v_expense_id,
    expected."userId",
    expected."amountPaise",
    expected.percentage,
    expected."shareWeight"
  FROM pg_catalog.jsonb_to_recordset(p_shares)
    AS expected("userId" UUID, "amountPaise" BIGINT, percentage NUMERIC, "shareWeight" NUMERIC)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_shares AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.user_id = expected."userId"
  );

  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(amount_paise), 0)
  INTO v_persisted_payer_count, v_persisted_payer_total
  FROM public.expense_payers
  WHERE expense_id = v_expense_id;
  SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(amount_paise), 0)
  INTO v_persisted_share_count, v_persisted_share_total
  FROM public.expense_shares
  WHERE expense_id = v_expense_id;

  IF v_persisted_payer_count <> v_payer_count
    OR v_persisted_payer_total <> v_amount_paise
    OR v_persisted_share_count <> v_share_count
    OR v_persisted_share_total <> v_amount_paise THEN
    RAISE EXCEPTION 'Persisted payer and participant records do not reconcile with the expense total'
      USING ERRCODE = '23514';
  END IF;

  IF v_restore_voided THEN
    UPDATE public.expenses
    SET status = 'active', voided_at = NULL, voided_by = NULL, void_reason = NULL
    WHERE id = v_expense_id;
  END IF;

  RETURN v_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) TO authenticated;

-- ============================================================================
-- SECTION: 017_fix_expense_participant_visibility.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
-- Qualify the outer expense id so participant access compares against the
-- current expense row rather than the payer/share row's own id.
DROP POLICY IF EXISTS "expenses_participant_select" ON public.expenses;

CREATE POLICY "expenses_participant_select"
  ON public.expenses FOR SELECT
  USING (
    status <> 'deleted'
    AND (
      creator_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.expense_payers AS payer
        WHERE payer.expense_id = expenses.id
          AND payer.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.expense_shares AS share
        WHERE share.expense_id = expenses.id
          AND share.user_id = auth.uid()
      )
      OR (
        group_id IS NOT NULL
        AND public.is_group_member(auth.uid(), group_id)
      )
    )
  );

-- ============================================================================
-- SECTION: 018_atomic_itemized_expense_creation.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
-- Persist itemized lines and allocations in the same transaction as the
-- expense, payer contributions, and participant shares.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_items_expense_sort_order
  ON public.expense_items (expense_id, sort_order);

CREATE OR REPLACE FUNCTION public.create_itemized_expense_with_records(
  p_expense JSONB,
  p_payers JSONB,
  p_shares JSONB,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_expense_id UUID;
  v_amount_paise BIGINT;
  v_split_method public.split_method;
  v_item_count BIGINT;
  v_distinct_sort_count BIGINT;
  v_named_item_count BIGINT;
  v_item_total NUMERIC;
  v_expected_allocation_count BIGINT;
  v_persisted_item_count BIGINT;
  v_persisted_allocation_count BIGINT;
BEGIN
  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Itemized expense payload must be an array' USING ERRCODE = '22023';
  END IF;

  v_expense_id := public.create_expense_with_records(p_expense, p_payers, p_shares);
  v_amount_paise := (p_expense->>'amount_paise')::BIGINT;
  v_split_method := (p_expense->>'split_method')::public.split_method;

  IF v_split_method <> 'itemized' THEN
    RAISE EXCEPTION 'Itemized expense RPC requires the itemized split method' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Itemized expenses require at least one item' USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT item.sort_order),
    pg_catalog.count(item.name),
    COALESCE(pg_catalog.sum(item.total_paise), 0)
  INTO v_item_count, v_distinct_sort_count, v_named_item_count, v_item_total
  FROM pg_catalog.jsonb_to_recordset(p_items) AS item(
    name TEXT,
    quantity NUMERIC,
    unit_price_paise BIGINT,
    total_paise BIGINT,
    sort_order INTEGER,
    allocations JSONB
  );

  IF v_item_count <> v_distinct_sort_count
    OR v_item_count <> v_named_item_count
    OR v_item_total <> v_amount_paise THEN
    RAISE EXCEPTION 'Item totals and ordering must reconcile with the expense'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS item(
      name TEXT,
      quantity NUMERIC,
      unit_price_paise BIGINT,
      total_paise BIGINT,
      sort_order INTEGER,
      allocations JSONB
    )
    WHERE item.name IS NULL
      OR pg_catalog.char_length(pg_catalog.btrim(item.name)) NOT BETWEEN 1 AND 100
      OR item.quantity IS NULL
      OR item.quantity <= 0
      OR item.unit_price_paise IS NULL
      OR item.unit_price_paise < 0
      OR item.total_paise IS NULL
      OR item.total_paise < 0
      OR item.sort_order IS NULL
      OR item.sort_order < 0
      OR pg_catalog.round(item.unit_price_paise::NUMERIC * item.quantity) <> item.total_paise
      OR pg_catalog.jsonb_typeof(item.allocations) IS DISTINCT FROM 'array'
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ) = 0
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
        WHERE allocation."userId" IS NULL
          OR allocation."amountPaise" IS NULL
          OR allocation."amountPaise" < 0
      ) > 0
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ) <> (
        SELECT pg_catalog.count(DISTINCT allocation."userId")
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      )
      OR COALESCE((
        SELECT pg_catalog.sum(allocation."amountPaise")
        FROM pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
          "userId" UUID,
          "amountPaise" BIGINT
        )
      ), 0) <> item.total_paise
  ) THEN
    RAISE EXCEPTION 'Item details and participant allocations are invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH item_allocations AS (
      SELECT allocation."userId" AS user_id,
        pg_catalog.sum(allocation."amountPaise") AS amount_paise
      FROM pg_catalog.jsonb_to_recordset(p_items) AS item(allocations JSONB)
      CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
        "userId" UUID,
        "amountPaise" BIGINT
      )
      GROUP BY allocation."userId"
    ),
    expected_shares AS (
      SELECT share."userId" AS user_id,
        pg_catalog.sum(share."amountPaise") AS amount_paise
      FROM pg_catalog.jsonb_to_recordset(p_shares) AS share(
        "userId" UUID,
        "amountPaise" BIGINT
      )
      GROUP BY share."userId"
    )
    SELECT 1
    FROM item_allocations
    FULL OUTER JOIN expected_shares USING (user_id)
    WHERE item_allocations.amount_paise IS DISTINCT FROM expected_shares.amount_paise
  ) THEN
    RAISE EXCEPTION 'Item allocations must match participant shares'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_items AS existing
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected(
      name TEXT,
      quantity NUMERIC,
      unit_price_paise BIGINT,
      total_paise BIGINT,
      sort_order INTEGER,
      allocations JSONB
    ) ON expected.sort_order = existing.sort_order
    WHERE existing.expense_id = v_expense_id
      AND (
        expected.sort_order IS NULL
        OR existing.name IS DISTINCT FROM pg_catalog.btrim(expected.name)
        OR existing.quantity IS DISTINCT FROM expected.quantity
        OR existing.unit_price_paise IS DISTINCT FROM expected.unit_price_paise
        OR existing.total_paise IS DISTINCT FROM expected.total_paise
      )
  ) THEN
    RAISE EXCEPTION 'Existing item records conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.expense_items (
    expense_id, name, quantity, unit_price_paise, total_paise, sort_order
  )
  SELECT
    v_expense_id,
    pg_catalog.btrim(expected.name),
    expected.quantity,
    expected.unit_price_paise,
    expected.total_paise,
    expected.sort_order
  FROM pg_catalog.jsonb_to_recordset(p_items) AS expected(
    name TEXT,
    quantity NUMERIC,
    unit_price_paise BIGINT,
    total_paise BIGINT,
    sort_order INTEGER,
    allocations JSONB
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.expense_items AS existing
    WHERE existing.expense_id = v_expense_id
      AND existing.sort_order = expected.sort_order
  );

  IF EXISTS (
    SELECT 1
    FROM public.expense_item_allocations AS existing
    JOIN public.expense_items AS item ON item.id = existing.item_id
    LEFT JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected_item(
      sort_order INTEGER,
      allocations JSONB
    ) ON expected_item.sort_order = item.sort_order
    LEFT JOIN LATERAL pg_catalog.jsonb_to_recordset(expected_item.allocations) AS expected_allocation(
      "userId" UUID,
      "amountPaise" BIGINT
    ) ON expected_allocation."userId" = existing.user_id
    WHERE item.expense_id = v_expense_id
      AND (
        expected_item.sort_order IS NULL
        OR expected_allocation."userId" IS NULL
        OR expected_allocation."amountPaise" IS DISTINCT FROM existing.amount_paise
      )
  ) THEN
    RAISE EXCEPTION 'Existing item allocations conflict with the retry payload'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.expense_item_allocations (item_id, user_id, amount_paise)
  SELECT item.id, allocation."userId", allocation."amountPaise"
  FROM public.expense_items AS item
  JOIN pg_catalog.jsonb_to_recordset(p_items) AS expected_item(
    sort_order INTEGER,
    allocations JSONB
  ) ON expected_item.sort_order = item.sort_order
  CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(expected_item.allocations) AS allocation(
    "userId" UUID,
    "amountPaise" BIGINT
  )
  WHERE item.expense_id = v_expense_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.expense_item_allocations AS existing
      WHERE existing.item_id = item.id
        AND existing.user_id = allocation."userId"
    );

  SELECT COALESCE(pg_catalog.sum(expected.allocation_count), 0)
  INTO v_expected_allocation_count
  FROM (
    SELECT pg_catalog.count(*) AS allocation_count
    FROM pg_catalog.jsonb_to_recordset(p_items) AS item(allocations JSONB)
    CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(item.allocations) AS allocation(
      "userId" UUID,
      "amountPaise" BIGINT
    )
  ) AS expected;

  SELECT pg_catalog.count(*)
  INTO v_persisted_item_count
  FROM public.expense_items
  WHERE expense_id = v_expense_id;

  SELECT pg_catalog.count(*)
  INTO v_persisted_allocation_count
  FROM public.expense_item_allocations AS allocation
  JOIN public.expense_items AS item ON item.id = allocation.item_id
  WHERE item.expense_id = v_expense_id;

  IF v_persisted_item_count <> v_item_count
    OR v_persisted_allocation_count <> v_expected_allocation_count THEN
    RAISE EXCEPTION 'Persisted item records do not match the retry payload'
      USING ERRCODE = '23514';
  END IF;

  RETURN v_expense_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_itemized_expense_with_records(JSONB, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_itemized_expense_with_records(JSONB, JSONB, JSONB, JSONB)
  TO authenticated;

-- ============================================================================
-- SECTION: 20261021223159_preserve_anonymized_ledger_identity.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
-- Preserve pseudonymized profile identities when a user removes their Auth account.
-- Financial and audit rows continue to reference public.profiles; deleting the
-- corresponding auth.users row must not cascade into that retained ledger identity.
DO $migration$
DECLARE
  v_fk RECORD;
  v_fk_count INTEGER;
  v_other_auth_fk_count INTEGER;
BEGIN
  SELECT pg_catalog.count(*)
  INTO v_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
    AND constraint_row.confrelid = 'auth.users'::pg_catalog.regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.confdeltype = 'c';

  IF v_fk_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one profiles-to-auth.users ON DELETE CASCADE foreign key; found %', v_fk_count;
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_other_auth_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.connamespace = 'public'::pg_catalog.regnamespace
    AND constraint_row.confrelid = 'auth.users'::pg_catalog.regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.conrelid <> 'public.profiles'::pg_catalog.regclass;

  IF v_other_auth_fk_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected public foreign keys reference auth.users; review before removing the profile link';
  END IF;

  SELECT constraint_row.conname
  INTO v_fk
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
    AND constraint_row.confrelid = 'auth.users'::pg_catalog.regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.confdeltype = 'c';

  EXECUTE pg_catalog.format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_fk.conname);
END;
$migration$;

COMMENT ON COLUMN public.profiles.id IS
  'Stable ledger identity. Account closure anonymizes this row and may delete the matching auth.users identity while retaining financial attribution.';

-- ============================================================================
-- SECTION: 20261021225434_revoke_excessive_app_table_privileges.sql
-- Source is the reviewed forward migration. Kept in original order.
-- ============================================================================
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


-- SECTION 9 — postconditions. Any failure aborts the enclosing transaction.
DO $postflight$
DECLARE
  v_tables TEXT[] := ARRAY[
    'profiles', 'friend_requests', 'invitation_tokens', 'groups', 'group_members',
    'expenses', 'expense_payers', 'expense_shares', 'expense_items',
    'expense_item_allocations', 'expense_history', 'settlements', 'notifications',
    'notification_preferences', 'push_subscriptions', 'idempotency_records', 'activity_log'
  ];
  v_table TEXT;
  v_privilege TEXT;
  v_signature TEXT;
  v_result TEXT;
  v_function RECORD;
  v_trigger_count INTEGER;
  v_fk_count INTEGER;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
      WHERE schema.nspname = 'public' AND relation.relname = ANY(v_tables)
        AND relation.relkind IN ('r','p') AND relation.relrowsecurity) <> 17 THEN
    RAISE EXCEPTION 'Postcondition failed: not all 17 application tables have RLS enabled';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I',v_table))
        AND policy.polname = 'active_account_required'
        AND NOT policy.polpermissive
        AND policy.polcmd = '*'
        AND to_regrole('authenticated') = ANY(policy.polroles)
    ) THEN
      RAISE EXCEPTION 'Postcondition failed: restrictive active-account policy missing on public.%', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I',v_table))
        AND trigger_row.tgname = 'active_account_write_guard'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) THEN
      RAISE EXCEPTION 'Postcondition failed: active-account write trigger missing on public.%', v_table;
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF pg_catalog.has_table_privilege('anon', pg_catalog.format('public.%I',v_table), v_privilege) THEN
        RAISE EXCEPTION 'Postcondition failed: anon retains % on public.%', v_privilege, v_table;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I',v_table), v_privilege) THEN
        RAISE EXCEPTION 'Postcondition failed: authenticated retains % on public.%', v_privilege, v_table;
      END IF;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
  WHERE schema.nspname = 'public'
    AND relation.relname = ANY(v_tables)
    AND trigger_row.tgname = 'active_account_write_guard'
    AND NOT trigger_row.tgisinternal;
  IF v_trigger_count <> 17 THEN
    RAISE EXCEPTION 'Postcondition failed: expected 17 active-account write guards; found %', v_trigger_count;
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.connamespace = 'public'::regnamespace
    AND constraint_row.confrelid = 'auth.users'::regclass
    AND constraint_row.contype = 'f';
  IF v_fk_count <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: public foreign keys still reference auth.users';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.invitation_tokens'::regclass
      AND trigger_row.tgname = 'invitation_token_integrity'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: invitation integrity trigger is absent or disabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.group_members'::regclass
      AND policy.polname = 'group_members_self_leave'
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: unsafe direct group self-leave policy remains';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.friend_requests'::regclass
      AND policy.polname = 'friend_requests_insert'
      AND pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid) ILIKE '%status = ''pending''%'
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: friend-request inserts are not pending-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.expenses'::regclass
      AND policy.polname = 'expenses_participant_select'
      AND pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) ILIKE '%payer.expense_id = expenses.id%'
      AND pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) ILIKE '%share.expense_id = expenses.id%'
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: expense participant visibility predicate is not corrected';
  END IF;

  FOR v_signature, v_result IN
    SELECT * FROM (VALUES
      ('public.accept_invitation(text)', 'jsonb'),
      ('public.are_friends(uuid,uuid)', 'boolean'),
      ('public.cancel_settlement(uuid)', 'uuid'),
      ('public.create_expense_with_records(jsonb,jsonb,jsonb)', 'uuid'),
      ('public.create_itemized_expense_with_records(jsonb,jsonb,jsonb,jsonb)', 'uuid'),
      ('public.delete_account()', 'json'),
      ('public.get_friend_balances()', 'TABLE(other_user_id uuid, net_paise bigint, owed_to_paise bigint, owing_paise bigint)'),
      ('public.get_group_balances(uuid)', 'TABLE(other_user_id uuid, net_paise bigint, owed_to_paise bigint, owing_paise bigint)'),
      ('public.get_invitation_preview(text)', 'jsonb'),
      ('public.get_profile_for_user(uuid)', 'TABLE(id uuid, username text, display_name text, avatar_url text, bio text, upi_id text, created_at timestamp with time zone, updated_at timestamp with time zone, deleted_at timestamp with time zone)'),
      ('public.get_settlement_recipient_upis()', 'TABLE(settlement_id uuid, upi_id text)'),
      ('public.is_active_account()', 'boolean'),
      ('public.leave_group(uuid)', 'void'),
      ('public.propose_settlement(uuid,bigint,text)', 'uuid'),
      ('public.respond_to_settlement(uuid,text)', 'uuid')
    ) AS expected(signature,result_type)
  LOOP
    IF to_regprocedure(v_signature) IS NULL
      OR pg_catalog.pg_get_function_result(to_regprocedure(v_signature)) <> v_result THEN
      RAISE EXCEPTION 'Postcondition failed: missing or incompatible RPC %', v_signature;
    END IF;
  END LOOP;

  FOR v_function IN
    SELECT function_row.oid::regprocedure AS signature, function_row.proconfig,
      function_row.proowner
    FROM pg_catalog.pg_proc AS function_row
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = function_row.pronamespace
    WHERE schema.nspname = 'public'
      AND function_row.prosecdef
      AND function_row.proname IN (
        'are_friends','is_group_member','is_group_admin','can_access_expense',
      'expense_pair_allocations',
        'handle_new_user','accept_invitation','accept_invitation_internal',
        'get_invitation_preview','delete_account','propose_settlement',
        'propose_settlement_internal','respond_to_settlement',
        'respond_to_settlement_internal','cancel_settlement','cancel_settlement_internal',
        'get_profile_for_user','get_profile_for_user_internal',
        'get_settlement_recipient_upis','get_settlement_recipient_upis_internal',
        'get_friend_balances','get_friend_balances_internal',
        'get_group_balances','get_group_balances_internal','leave_group',
        'is_active_account','enforce_active_account_write',
        'enforce_invitation_token_integrity','create_expense_with_records',
        'create_itemized_expense_with_records'
      )
  LOOP
    IF v_function.proowner <> to_regrole('postgres') THEN
      RAISE EXCEPTION 'Postcondition failed: SECURITY DEFINER function % has unexpected owner', v_function.signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(v_function.proconfig, ARRAY[]::TEXT[])) AS setting
      WHERE setting IN (
        'search_path=pg_catalog, public, pg_temp',
        'search_path=pg_catalog, public, auth, pg_temp'
      )
    ) THEN
      RAISE EXCEPTION 'Postcondition failed: SECURITY DEFINER function % has no reviewed safe search_path', v_function.signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('anon','public.get_invitation_preview(text)','EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'Postcondition failed: intended public invitation preview is not executable by anon';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.accept_invitation(text)','public.are_friends(uuid,uuid)',
    'public.can_access_expense(uuid,uuid)','public.is_group_member(uuid,uuid)',
    'public.is_group_admin(uuid,uuid)',
    'public.cancel_settlement(uuid)','public.create_expense_with_records(jsonb,jsonb,jsonb)',
    'public.create_itemized_expense_with_records(jsonb,jsonb,jsonb,jsonb)',
    'public.delete_account()','public.get_friend_balances()',
    'public.get_group_balances(uuid)','public.get_profile_for_user(uuid)',
    'public.get_settlement_recipient_upis()','public.is_active_account()',
    'public.leave_group(uuid)','public.propose_settlement(uuid,bigint,text)',
    'public.respond_to_settlement(uuid,text)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondition failed: anon can execute private function %', v_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondition failed: authenticated cannot execute required function %', v_signature;
    END IF;
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.expense_pair_allocations(uuid,uuid)',
    'public.handle_new_user()',
    'public.enforce_active_account_write()',
    'public.enforce_invitation_token_integrity()',
    'public.accept_invitation_internal(text)',
    'public.propose_settlement_internal(uuid,bigint,text)',
    'public.respond_to_settlement_internal(uuid,text)',
    'public.cancel_settlement_internal(uuid)',
    'public.get_profile_for_user_internal(uuid)',
    'public.get_settlement_recipient_upis_internal()',
    'public.get_friend_balances_internal()',
    'public.get_group_balances_internal(uuid)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondition failed: internal function remains directly executable: %', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
    WHERE schema.nspname = 'public'
      AND defaults.defaclrole = to_regrole('postgres')
      AND defaults.defaclobjtype = 'r'
      AND acl.grantee IN (0,to_regrole('anon'))
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: PUBLIC or anon retains default privileges on future postgres-owned tables';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
    WHERE schema.nspname = 'public'
      AND defaults.defaclrole = to_regrole('postgres')
      AND defaults.defaclobjtype = 'r'
      AND acl.grantee = to_regrole('authenticated')
      AND acl.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: authenticated retains high-risk default table privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_index AS index_row ON index_row.indexrelid = index_relation.oid
    WHERE index_relation.oid = 'public.idx_expense_items_expense_sort_order'::regclass
      AND index_row.indisunique AND index_row.indisvalid
      AND pg_catalog.pg_get_indexdef(index_row.indexrelid) ILIKE '%(expense_id, sort_order)%'
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: item sort uniqueness index is missing or invalid';
  END IF;

  RAISE NOTICE 'Fall Split forward repair postconditions passed; review the transaction result before relying on the API.';
END;
$postflight$;

COMMIT;
