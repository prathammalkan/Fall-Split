import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20261023220000_restore_rls_scoped_postgrest_access.sql?raw';
import narrowingMigration from '../../supabase/migrations/20261023223000_narrow_authenticated_app_table_privileges.sql?raw';
import invitationCreationMigration from '../../supabase/migrations/20261023230000_restore_authenticated_invitation_creation.sql?raw';

describe('PostgREST access restoration migration', () => {
  it('restores schema usage without schema creation or anonymous table access', () => {
    expect(migration).toContain('GRANT USAGE ON SCHEMA public TO anon, authenticated;');
    expect(migration).not.toMatch(/GRANT\s+CREATE/i);
    expect(migration).toContain("has_schema_privilege('anon', 'public', 'CREATE')");
    expect(migration).toContain("has_schema_privilege('authenticated', 'public', 'CREATE')");
    expect(migration).toContain("'Anonymous app-table reads must remain revoked'");
  });

  it('grants only queried authenticated data access and preserves RLS', () => {
    expect(migration).toContain('GRANT SELECT (id, sender_id, receiver_id, status, created_at)');
    expect(migration).toContain('GRANT INSERT (sender_id, receiver_id)');
    expect(migration).toMatch(
      /GRANT SELECT\s+ON TABLE public\.groups, public\.group_members, public\.expenses/
    );
    expect(migration).toContain('GRANT SELECT (expense_id, user_id, amount_paise)');
    expect(migration).toContain('GRANT UPDATE (read_at)');
    expect(migration).toContain(
      "'friend_requests', 'friend_requests_insert', '48bb9ca3bb21087b7a71a403678a5939'"
    );
    expect(migration).toContain(
      "'expenses', 'expenses_participant_select', 'e7101ee5effe928695c084e9918157b6'"
    );
    expect(migration).toContain('NOT relation.relrowsecurity');
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(migration).not.toMatch(/GRANT\s+ALL\s+PRIVILEGES/i);
  });

  it('keeps private RPC execution separate from public invitation preview', () => {
    expect(migration).toContain(
      "has_function_privilege('anon', 'public.get_invitation_preview(text)', 'EXECUTE')"
    );
    expect(migration).toContain(
      "has_function_privilege('anon', 'public.get_friend_balances()', 'EXECUTE')"
    );
    expect(migration).toContain(
      "has_function_privilege('authenticated', 'public.get_friend_balances()', 'EXECUTE')"
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.prevent_settlement_history_mutation()'
    );
  });

  it('removes table-wide app privileges while restoring only RLS-scoped access', () => {
    expect(narrowingMigration).toContain('FROM PUBLIC, anon, authenticated;');
    expect(narrowingMigration).toMatch(
      /GRANT SELECT\s+ON TABLE public\.groups, public\.group_members, public\.expenses/
    );
    expect(narrowingMigration).toContain('GRANT UPDATE (status)');
    expect(narrowingMigration).toContain(
      'GRANT UPDATE (status, voided_at, voided_by, void_reason)'
    );
    expect(narrowingMigration).toContain(
      'GRANT SELECT ON TABLE public.discoverable_profiles TO authenticated;'
    );
    expect(narrowingMigration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;'
    );
    expect(narrowingMigration).toContain(
      'REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;'
    );
    expect(narrowingMigration).toContain(
      "privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'"
    );
    expect(narrowingMigration).not.toMatch(/GRANT\s+(ALL|INSERT\s*,\s*UPDATE\s*,\s*DELETE)/i);
    expect(narrowingMigration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('restores authenticated invitation creation and selection under RLS and integrity trigger', () => {
    expect(invitationCreationMigration).toContain(
      'GRANT SELECT (id, token, type, creator_id, target_id, max_uses, use_count, expires_at, created_at, revoked_at)'
    );
    expect(invitationCreationMigration).toContain(
      'GRANT INSERT (token, type, creator_id, target_id, max_uses, expires_at)'
    );
    expect(invitationCreationMigration).toContain(
      "has_column_privilege('authenticated', 'public.invitation_tokens', 'token', 'INSERT')"
    );
    expect(invitationCreationMigration).toContain(
      "has_column_privilege('authenticated', 'public.invitation_tokens', 'token', 'SELECT')"
    );
    expect(invitationCreationMigration).toContain(
      "'Anonymous access to invitation_tokens must remain completely revoked'"
    );
    expect(invitationCreationMigration).toContain(
      "'Excessive authenticated privileges detected on invitation_tokens'"
    );
    expect(invitationCreationMigration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(invitationCreationMigration).not.toMatch(/GRANT\s+ALL/i);
  });
});
