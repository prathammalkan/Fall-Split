-- Migration 007: Add missing columns to bring live DB in sync with application types
-- These columns exist in database.types.ts but were absent from the live schema.

-- ─── groups.avatar_url ────────────────────────────────────────────────────────
-- The TypeScript types declare avatar_url on groups; add it to the DB to match.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ─── expense_shares timestamps ────────────────────────────────────────────────
-- Add created_at / updated_at to expense_shares for consistency and audit trail.
ALTER TABLE public.expense_shares
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─── expense_items timestamps ─────────────────────────────────────────────────
ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─── Add updated_at trigger for groups (has updated_at already) ───────────────
-- Already handled by existing trigger in 001_core_schema.sql.
-- No action needed.

-- ─── Verify: check function existence ────────────────────────────────────────
-- get_friend_balances, get_group_balances, accept_invitation all confirmed live.
-- No function migrations needed.
