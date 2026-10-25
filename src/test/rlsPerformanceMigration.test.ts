import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20261024130000_optimize_rls_initplan_evaluations.sql?raw';

describe('RLS performance optimization migration contract (InitPlan)', () => {
  it('wraps auth.uid() in scalar subquery (SELECT auth.uid()) across core tables', () => {
    // profiles
    expect(migration).toContain('CREATE POLICY "profiles_own_select"');
    expect(migration).toContain('USING ((SELECT auth.uid()) = id AND deleted_at IS NULL);');
    expect(migration).toContain('CREATE POLICY "profiles_own_update"');
    expect(migration).toContain('USING ((SELECT auth.uid()) = id)');
    expect(migration).toContain('WITH CHECK ((SELECT auth.uid()) = id);');

    // friend_requests
    expect(migration).toContain('CREATE POLICY "friend_requests_select"');
    expect(migration).toContain(
      'AND (sender_id = (SELECT auth.uid()) OR receiver_id = (SELECT auth.uid()))'
    );

    // groups and members
    expect(migration).toContain('CREATE POLICY "groups_member_select"');
    expect(migration).toContain('USING (public.is_group_member((SELECT auth.uid()), id));');
    expect(migration).toContain('CREATE POLICY "group_members_member_select"');
    expect(migration).toContain('USING (public.is_group_member((SELECT auth.uid()), group_id));');

    // expenses
    expect(migration).toContain('CREATE POLICY "expenses_participant_select"');
    expect(migration).toContain('payer.user_id = (SELECT auth.uid())');
    expect(migration).toContain('share.user_id = (SELECT auth.uid())');

    // payers & shares
    expect(migration).toContain('CREATE POLICY "expense_payers_select"');
    expect(migration).toContain(
      'USING (public.can_access_expense((SELECT auth.uid()), expense_id));'
    );
    expect(migration).toContain('CREATE POLICY "expense_shares_select"');
    expect(migration).toContain(
      'USING (public.can_access_expense((SELECT auth.uid()), expense_id));'
    );

    // settlements
    expect(migration).toContain('CREATE POLICY "settlements_parties_select"');
    expect(migration).toContain('payer_id = (SELECT auth.uid())');
    expect(migration).toContain('recipient_id = (SELECT auth.uid())');

    // user-specific data
    expect(migration).toContain('CREATE POLICY "notifications_own"');
    expect(migration).toContain('USING (user_id = (SELECT auth.uid()))');
    expect(migration).toContain('CREATE POLICY "idempotency_own"');
    expect(migration).toContain('USING (user_id = (SELECT auth.uid()))');
  });

  it('preserves all access semantics, row-ownership, and membership guards', () => {
    // Exact policy predicate assertions
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('payer_id <> recipient_id');
    expect(migration).toContain("status = 'pending'");
    expect(migration).toContain('sender_id <> receiver_id');
    expect(migration).toContain("tablename = 'expense_approvals'");

    // No security weakening
    expect(migration).not.toMatch(/GRANT ALL ON ALL TABLES IN SCHEMA public/i);
    expect(migration).not.toMatch(/TO anon/i);
    expect(migration).not.toMatch(/USING \(true\)/i);
    expect(migration).not.toMatch(/WITH CHECK \(true\)/i);
  });
});
