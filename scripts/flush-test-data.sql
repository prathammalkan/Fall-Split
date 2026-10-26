-- Fall Split: Flush all test data for fresh production start
-- Safe to run: truncates data tables only; schema and migrations are unaffected.
-- Authorized by project owner on 2026-10-26.
-- Run via: psql <connection_string> -f scripts/flush-test-data.sql
-- Or via Supabase SQL editor.

BEGIN;

-- Disable triggers temporarily to avoid cascade issues during truncation
SET session_replication_role = replica;

-- Truncate in dependency order (child tables first)
TRUNCATE TABLE public.expense_item_allocations CASCADE;
TRUNCATE TABLE public.expense_items CASCADE;
TRUNCATE TABLE public.expense_approvals CASCADE;
TRUNCATE TABLE public.expense_history CASCADE;
TRUNCATE TABLE public.expense_shares CASCADE;
TRUNCATE TABLE public.expense_payers CASCADE;
TRUNCATE TABLE public.expenses CASCADE;
TRUNCATE TABLE public.settlements CASCADE;
TRUNCATE TABLE public.activity_log CASCADE;
TRUNCATE TABLE public.notifications CASCADE;
TRUNCATE TABLE public.notification_preferences CASCADE;
TRUNCATE TABLE public.push_subscriptions CASCADE;
TRUNCATE TABLE public.group_members CASCADE;
TRUNCATE TABLE public.groups CASCADE;
TRUNCATE TABLE public.friend_requests CASCADE;
TRUNCATE TABLE public.invitation_tokens CASCADE;

-- Reset profile data but keep auth.users intact
-- (Profiles are linked to auth.users via FK; deleting profiles would require deleting auth users too)
-- Instead: clear user-generated content and social graph only.
-- Do NOT truncate profiles (would break auth).

-- Restore trigger behavior
SET session_replication_role = DEFAULT;

COMMIT;

-- Note: auth.users rows remain; users can log in but will have fresh empty app state.
-- To also delete auth users, use Supabase dashboard: Authentication > Users.
