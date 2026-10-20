-- Migration 004: Add missing rejected_at column to settlements
-- The SettlementsPage calls update({ rejected_at: ... }) but this column was absent.
-- Also adds cancelled_at consistency check.

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- Update consistency check: rejected status must have rejected_at set
-- (only add if not already there)
ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS rejected_consistency;

ALTER TABLE public.settlements
  ADD CONSTRAINT rejected_consistency CHECK (
    (status = 'rejected') = (rejected_at IS NOT NULL)
  );

-- Add index for query efficiency
CREATE INDEX IF NOT EXISTS idx_settlements_rejected_at
  ON public.settlements (rejected_at) WHERE rejected_at IS NOT NULL;

COMMENT ON COLUMN public.settlements.rejected_at IS
  'Timestamp when the recipient rejected this settlement; set when status = rejected';
