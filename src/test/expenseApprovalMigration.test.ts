import { describe, expect, it } from 'vitest';
import rawMigration from '../../supabase/migrations/20261024120000_participant_expense_approval.sql?raw';

const migration = rawMigration.replace(/\r\n/g, '\n');

describe('Participant expense approval migration contract', () => {
  it('extends expense_status enum with required approval statuses', () => {
    expect(migration).toContain("ALTER TYPE public.expense_status ADD VALUE 'pending_approval';");
    expect(migration).toContain("ALTER TYPE public.expense_status ADD VALUE 'disputed';");
    expect(migration).toContain("ALTER TYPE public.expense_status ADD VALUE 'confirmed';");
    expect(migration).toContain("ALTER TYPE public.expense_status ADD VALUE 'cancelled';");
  });

  it('creates expense_approvals table with appropriate schema and foreign keys', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.expense_approvals (');
    expect(migration).toContain(
      'expense_id       UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE'
    );
    expect(migration).toContain(
      'user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE'
    );
    expect(migration).toContain("status           TEXT NOT NULL DEFAULT 'pending'");
    expect(migration).toContain(
      "CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'disputed'))"
    );
    expect(migration).toContain('dispute_reason   TEXT');
    expect(migration).toContain('dispute_category TEXT');
    expect(migration).toContain(
      'CONSTRAINT unique_expense_participant_approval UNIQUE (expense_id, user_id)'
    );
  });

  it('enables RLS on expense_approvals and configures authenticated select policy', () => {
    expect(migration).toContain('ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('CREATE POLICY "expense_approvals_select"');
    expect(migration).toContain('ON public.expense_approvals');
    expect(migration).toContain('FOR SELECT');
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('USING (public.can_access_expense(auth.uid(), expense_id));');
  });

  it('defines respond_to_expense_approval with SECURITY DEFINER and hardened search path', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.respond_to_expense_approval(');
    expect(migration).toContain('p_expense_id UUID,');
    expect(migration).toContain('p_action TEXT,');
    expect(migration).toContain('p_dispute_reason TEXT DEFAULT NULL,');
    expect(migration).toContain('p_dispute_category TEXT DEFAULT NULL');
    expect(migration).toContain('RETURNS JSONB');
    expect(migration).toContain('LANGUAGE plpgsql');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public, auth, pg_temp');
    expect(migration).toContain('SET row_security = off');
  });

  it('enforces caller authentication and active account checks', () => {
    expect(migration).toContain('v_user_id UUID := auth.uid();');
    expect(migration).toContain('IF v_user_id IS NULL OR NOT public.is_active_account() THEN');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE = '42501';"
    );
  });

  it('validates action argument and ensures atomic locking before approval state changes', () => {
    expect(migration).toContain("IF p_action NOT IN ('approve', 'dispute') THEN");
    expect(migration).toContain(
      "RAISE EXCEPTION 'Invalid approval action. Must be approve or dispute' USING ERRCODE = '22023';"
    );
    expect(migration).toContain(
      'PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expense_id::TEXT, 0));'
    );
    expect(migration).toContain('WHERE expense_id = p_expense_id AND user_id = v_user_id');
    expect(migration).toContain('FOR UPDATE;');
  });

  it('validates participant authorization: only assigned participant can approve or dispute', () => {
    expect(migration).toContain('SELECT * INTO v_approval');
    expect(migration).toContain('WHERE expense_id = p_expense_id AND user_id = v_user_id');
    expect(migration).toContain(
      "RAISE EXCEPTION 'You are not a required participant for this expense approval'"
    );
  });

  it('advances expense to confirmed when all participant approvals are granted', () => {
    expect(migration).toContain('SELECT 1 FROM public.expense_approvals');
    expect(migration).toContain("WHERE expense_id = p_expense_id AND status <> 'approved'");
    expect(migration).toContain('IF v_all_approved THEN');
    expect(migration).toContain("v_new_status := 'confirmed';");
    expect(migration).toContain("SET status = 'confirmed'");
  });

  it('strictly restricts balance calculations to confirmed or active expenses (balance invariant)', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.expense_pair_allocations(');
    expect(migration).toContain("WHERE expense.status IN ('active', 'confirmed')");
  });

  it('hardens execute permissions on respond_to_expense_approval', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.respond_to_expense_approval(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.respond_to_expense_approval(UUID, TEXT, TEXT, TEXT) TO authenticated;'
    );
  });

  it('invalidates participant approvals and resets status on material edits in update_expense_with_records', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.update_expense_with_records(');
    expect(migration).toContain("v_new_status := 'pending_approval'::public.expense_status;");
    expect(migration).toContain(
      'INSERT INTO public.expense_approvals (expense_id, user_id, status)'
    );
    expect(migration).toContain('ON CONFLICT (expense_id, user_id) DO UPDATE');
    expect(migration).toContain("SET status = 'pending',");
    expect(migration).toContain('dispute_reason = NULL,');
    expect(migration).toContain('dispute_category = NULL,');
    expect(migration).toContain('change_type, previous_data, new_data, changed_at');
    expect(migration).toContain("'update_with_approval_invalidation'");
  });

  it('backfills historical active expenses as confirmed and seeds approval rows for non-creators', () => {
    expect(migration).toContain(
      "UPDATE public.expenses\nSET status = 'confirmed'\nWHERE status = 'active';"
    );
    expect(migration).toContain(
      'INSERT INTO public.expense_approvals (expense_id, user_id, status, responded_at)'
    );
    expect(migration).toContain("WHERE e.status = 'confirmed'");
    expect(migration).toContain('AND share.user_id <> e.creator_id');
    expect(migration).toContain('ON CONFLICT (expense_id, user_id) DO NOTHING;');
  });

  it('updates delete_expense to clean up child expense_approvals rows on soft deletion', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id UUID)'
    );
    expect(migration).toContain(
      'DELETE FROM public.expense_approvals WHERE expense_id = p_expense_id;'
    );
  });

  it('hardens permissions and validates resource abuse limits on RPCs', () => {
    // Permission revocations
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.expense_pair_allocations(UUID, UUID) FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) FROM PUBLIC, anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_expense_with_records(JSONB, JSONB, JSONB) TO authenticated;'
    );

    // Resource abuse and numeric bounds
    expect(migration).toContain('v_amount_paise > 100000000000');
    expect(migration).toContain('v_share_count > 100 OR v_payer_count > 50');
    expect(migration).toContain('A valid dispute reason is required');
    expect(migration).toContain('Dispute details exceed maximum allowed length');
  });
});
