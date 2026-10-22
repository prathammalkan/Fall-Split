import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/013_security_financial_reconciliation.sql?raw';
import activeAccountMigration from '../../supabase/migrations/014_active_account_enforcement.sql?raw';
import coreSchema from '../../supabase/migrations/001_core_schema.sql?raw';
import rlsPolicies from '../../supabase/migrations/002_rls_policies.sql?raw';
import relationshipAuthorizationMigration from '../../supabase/migrations/015_relationship_authorization.sql?raw';
import expenseParticipantVisibilityMigration from '../../supabase/migrations/017_fix_expense_participant_visibility.sql?raw';
import itemizedExpenseMigration from '../../supabase/migrations/018_atomic_itemized_expense_creation.sql?raw';
import accountRetentionMigration from '../../supabase/migrations/20261021223159_preserve_anonymized_ledger_identity.sql?raw';
import appTablePrivilegesMigration from '../../supabase/migrations/20261021225434_revoke_excessive_app_table_privileges.sql?raw';

describe('security and financial remediation migration source contracts', () => {
  it('binds payer and share visibility to the outer expense row', () => {
    expect(expenseParticipantVisibilityMigration).toMatch(
      /payer\.expense_id = expenses\.id[\s\S]*payer\.user_id = auth\.uid\(\)/
    );
    expect(expenseParticipantVisibilityMigration).toMatch(
      /share\.expense_id = expenses\.id[\s\S]*share\.user_id = auth\.uid\(\)/
    );
    expect(expenseParticipantVisibilityMigration).not.toMatch(/(?:payer|share)\.expense_id = id\b/);
  });

  it('creates itemized expenses atomically and validates idempotent retries', () => {
    expect(itemizedExpenseMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_itemized_expense_with_records\([\s\S]*?public\.create_expense_with_records\(p_expense, p_payers, p_shares\)/
    );
    expect(itemizedExpenseMigration).toMatch(
      /Item totals and ordering must reconcile with the expense/
    );
    expect(itemizedExpenseMigration).toMatch(/Item allocations must match participant shares/);
    expect(itemizedExpenseMigration).toMatch(
      /Existing item records conflict with the retry payload/
    );
    expect(itemizedExpenseMigration).toMatch(
      /Existing item allocations conflict with the retry payload/
    );
    expect(itemizedExpenseMigration).toMatch(/idx_expense_items_expense_sort_order/);
    expect(itemizedExpenseMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_itemized_expense_with_records\(JSONB, JSONB, JSONB, JSONB\)\s+FROM PUBLIC, anon/
    );
    expect(itemizedExpenseMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_itemized_expense_with_records\(JSONB, JSONB, JSONB, JSONB\)\s+TO authenticated/
    );
  });

  it('removes direct member updates and makes self-leave identity-bound', () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "group_members_self_leave"/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.leave_group\(p_group_id UUID\)/);
    expect(migration).toMatch(/WHERE group_id = p_group_id\s+AND user_id = v_user_id/);
    const leaveFunction = migration
      .split('CREATE OR REPLACE FUNCTION public.leave_group')[1]!
      .split('$function$;')[0]!;
    expect(leaveFunction).toMatch(/SET removed_at = pg_catalog\.now\(\)/);
    expect(leaveFunction).not.toMatch(
      /UPDATE public\.group_members\s+SET\s+(?:role|user_id|group_id)\s*=/i
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.leave_group\(UUID\) FROM PUBLIC, anon/
    );
  });

  it('limits discoverable profile columns and binds full profile access to self or friends', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(/GRANT SELECT \(id, username, display_name, avatar_url\)/);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.discoverable_profiles/);
    expect(migration).toMatch(
      /profile\.id = auth\.uid\(\)\s+OR public\.are_friends\(auth\.uid\(\), profile\.id\)/
    );
    expect(migration).toMatch(
      /REVOKE SELECT \(id, username, display_name, avatar_url, bio, upi_id/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_profile_for_user\(UUID\) FROM PUBLIC, anon/
    );
    expect(migration).toMatch(
      /RETURNS TABLE \(\s*id UUID,\s*username TEXT,\s*display_name TEXT,\s*avatar_url TEXT,\s*bio TEXT,\s*upi_id TEXT,/
    );
    expect(migration).not.toMatch(/SELECT profile\.\*/);
    expect(migration).not.toMatch(
      /CREATE OR REPLACE VIEW public\.discoverable_profiles[\s\S]*?WHERE deleted_at IS NULL/
    );
    expect(migration).not.toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/);
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/
    );
    expect(rlsPolicies).toMatch(
      /CREATE POLICY "profiles_username_search"[\s\S]*?deleted_at IS NULL/
    );
  });

  it('revokes anonymous helper execution without revoking public invitation preview', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.are_friends\(UUID, UUID\) FROM PUBLIC, anon/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.can_access_expense\(UUID, UUID\) FROM PUBLIC, anon/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.are_friends\(UUID, UUID\) TO authenticated/
    );
    expect(migration).toMatch(
      /settlement\.payer_id = auth\.uid\(\)[\s\S]*settlement\.status IN \('proposed', 'pending'\)/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_settlement_recipient_upis\(\) FROM PUBLIC, anon/
    );
    for (const functionName of [
      'are_friends',
      'is_group_member',
      'is_group_admin',
      'can_access_expense',
      'accept_invitation',
      'get_friend_balances',
      'get_group_balances',
      'get_settlement_recipient_upis',
      'delete_account',
      'propose_settlement',
      'respond_to_settlement',
      'cancel_settlement',
    ]) {
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}.* TO authenticated;`)
      );
    }
    expect(migration).not.toMatch(/REVOKE[^;]*get_invitation_preview[^;]*FROM[^;]*anon/i);
    for (const signature of [
      'are_friends\\(UUID, UUID\\)',
      'is_group_member\\(UUID, UUID\\)',
      'is_group_admin\\(UUID, UUID\\)',
      'can_access_expense\\(UUID, UUID\\)',
      'handle_new_user\\(\\)',
      'accept_invitation\\(TEXT\\)',
      'get_invitation_preview\\(TEXT\\)',
      'delete_account\\(\\)',
      'propose_settlement\\(UUID, BIGINT, TEXT\\)',
      'respond_to_settlement\\(UUID, TEXT\\)',
      'cancel_settlement\\(UUID\\)',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `ALTER FUNCTION public\\.${signature} SET search_path = pg_catalog, public, pg_temp;`
        )
      );
    }
  });

  it('uses deterministic integer-paise multi-payer allocation for both balance RPCs', () => {
    expect(migration).toMatch(
      /ORDER BY v_remainders\[v_node\]\[candidate\.idx\] DESC, v_payer_ids\[candidate\.idx\]/
    );
    expect(migration).toMatch(
      /v_column_remaining\[v_j\] := \(v_payer_amounts\[v_j\] - v_column_base\)::INTEGER/
    );
    expect(migration).toMatch(
      /FROM public\.expense_pair_allocations\(\(SELECT uid FROM caller\), NULL::UUID\) AS allocation/
    );
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_friend_balances\(\)/);
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_group_balances\(p_group_id UUID\)/
    );
    expect(migration).toMatch(/Active expense % payer, share, and total amounts do not reconcile/);
    expect(migration).not.toMatch(/AND \(\s*SELECT pg_catalog\.sum\(payer\.amount_paise\)/);
  });

  it('derives account deletion identity from auth.uid and raises on failed profile lookup', () => {
    expect(migration).toMatch(/v_user_id UUID := auth\.uid\(\)/);
    expect(migration).toMatch(
      /IF v_profile_id IS NULL THEN\s+RAISE EXCEPTION 'Account profile not found'/
    );
    expect(migration).not.toMatch(/delete_account\([^)]*user_id/i);
  });

  it('keeps retained financial references that can block hard Auth-user deletion visible', () => {
    expect(coreSchema).toMatch(/creator_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\),/);
    expect(coreSchema).toMatch(/user_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\),/);
    expect(coreSchema).toMatch(/payer_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\),/);
    expect(coreSchema).toMatch(/recipient_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\),/);
  });

  it('detaches Auth identity only after preserving the anonymized ledger profile', () => {
    expect(accountRetentionMigration).toMatch(/v_fk_count <> 1/);
    expect(accountRetentionMigration).toMatch(/v_other_auth_fk_count <> 0/);
    expect(accountRetentionMigration).toMatch(/DROP CONSTRAINT %I/);
    expect(accountRetentionMigration).toMatch(/COMMENT ON COLUMN public\.profiles\.id/);
    expect(accountRetentionMigration).not.toMatch(
      /DELETE FROM public\.(expenses|expense_payers|expense_shares|expense_history|settlements)/
    );
    expect(activeAccountMigration).toMatch(
      /username = 'deleted_' \|\| pg_catalog\.substring\(pg_catalog\.replace\(v_user_id::TEXT, '-', ''\), 1, 22\)/
    );
  });

  it('gates RLS and security-definer writes on the caller profile without changing ledger references', () => {
    expect(activeAccountMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_active_account\(\)/
    );
    expect(activeAccountMigration).toMatch(/auth\.uid\(\)[\s\S]*profile\.deleted_at IS NULL/);
    expect(activeAccountMigration).toMatch(/SET search_path = pg_catalog, public, auth, pg_temp/);
    expect(activeAccountMigration).toMatch(/SET row_security = off/);
    expect(activeAccountMigration).toMatch(
      /AS RESTRICTIVE FOR ALL TO authenticated USING \(public\.is_active_account\(\)\)/
    );
    expect(activeAccountMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_active_account_write\(\)/
    );
    expect(activeAccountMigration).toMatch(
      /IF auth\.uid\(\) IS NOT NULL AND NOT public\.is_active_account\(\) THEN/
    );
    expect(activeAccountMigration).toMatch(
      /CREATE TRIGGER active_account_write_guard BEFORE INSERT OR UPDATE OR DELETE/
    );
    expect(activeAccountMigration).toMatch(
      /UPDATE public\.profiles[\s\S]*WHERE id = v_user_id[\s\S]*RETURNING id INTO v_profile_id/
    );
    expect(activeAccountMigration).not.toMatch(
      /DELETE FROM public\.(expenses|expense_payers|expense_shares|expense_history|settlements)/
    );
    expect(activeAccountMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_profile_for_user_internal\(UUID\) FROM PUBLIC, anon, authenticated/
    );
    expect(activeAccountMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_friend_balances_internal\(\) FROM PUBLIC, anon, authenticated/
    );
    for (const table of [
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
      'activity_log',
    ]) {
      expect(activeAccountMigration).toContain(`'${table}'`);
    }
    for (const functionName of [
      'accept_invitation',
      'propose_settlement',
      'respond_to_settlement',
      'cancel_settlement',
      'leave_group',
      'delete_account',
    ]) {
      expect(activeAccountMigration).toMatch(
        new RegExp(`public\\.${functionName}[\\s\\S]*?Active account required`)
      );
    }
  });

  it('keeps internal relationship helpers caller-bound and leaves invitation preview public', () => {
    for (const argument of ['user_a', 'p_user_id']) {
      expect(activeAccountMigration).toMatch(new RegExp(`${argument} = auth\\.uid\\(\\)`));
    }
    expect(activeAccountMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.are_friends\(UUID, UUID\) FROM PUBLIC, anon, authenticated/
    );
    expect(activeAccountMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.are_friends\(UUID, UUID\) TO authenticated/
    );
    expect(activeAccountMigration).not.toMatch(
      /REVOKE[^;]*get_invitation_preview[^;]*FROM[^;]*anon/i
    );
  });

  it('prevents arbitrary relationship-helper probes in 013', () => {
    for (const helper of [
      'are_friends(user_a UUID, user_b UUID)',
      'is_group_member(p_user_id UUID, p_group_id UUID)',
      'is_group_admin(p_user_id UUID, p_group_id UUID)',
      'can_access_expense(p_user_id UUID, p_expense_id UUID)',
    ]) {
      const helperDefinition = migration.split(`CREATE OR REPLACE FUNCTION public.${helper}`)[1];
      expect(helperDefinition).toBeDefined();
      expect(helperDefinition).toMatch(
        /auth\.uid\(\) IS NOT NULL[\s\S]*?(user_a|p_user_id) = auth\.uid\(\)/
      );
    }
  });

  it('prevents direct accepted-friendship writes and unauthorized group invitations', () => {
    expect(relationshipAuthorizationMigration).toMatch(/status = 'pending'/);
    expect(relationshipAuthorizationMigration).toMatch(
      /REVOKE UPDATE ON TABLE public\.friend_requests FROM PUBLIC, anon, authenticated/
    );
    expect(relationshipAuthorizationMigration).toMatch(
      /GRANT UPDATE \(status\) ON TABLE public\.friend_requests TO authenticated/
    );
    expect(relationshipAuthorizationMigration).toMatch(/sender_id = auth\.uid\(\)/);
    expect(relationshipAuthorizationMigration).toMatch(/NEW\.creator_id <> auth\.uid\(\)/);
    expect(relationshipAuthorizationMigration).toMatch(
      /NEW\.type = 'group'[\s\S]*member\.role = 'admin'/
    );
    expect(relationshipAuthorizationMigration).toMatch(
      /Group invitation creator must remain an active group admin/
    );
    expect(relationshipAuthorizationMigration).toMatch(
      /REVOKE UPDATE ON TABLE public\.invitation_tokens FROM PUBLIC, anon, authenticated/
    );
    expect(relationshipAuthorizationMigration).toMatch(
      /GRANT UPDATE \(revoked_at\) ON TABLE public\.invitation_tokens TO authenticated/
    );
  });

  it('removes anonymous app-table grants and RLS-bypassing privileges', () => {
    expect(appTablePrivilegesMigration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon/
    );
    expect(appTablePrivilegesMigration).toMatch(
      /REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public\.%I FROM authenticated/
    );
    expect(appTablePrivilegesMigration).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon/
    );
    expect(appTablePrivilegesMigration).toMatch(/IF current_user <> 'postgres'/);
    expect(appTablePrivilegesMigration).toMatch(
      /v_table_count <> pg_catalog\.cardinality\(v_app_tables\)/
    );
  });
});
