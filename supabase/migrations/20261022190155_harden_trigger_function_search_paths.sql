-- Trigger functions execute with the table owner's context. Pin their lookup
-- path so an attacker cannot influence unqualified object resolution through a
-- mutable role-level search_path.
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.prevent_settlement_history_mutation()
  SET search_path = pg_catalog, public, pg_temp;
