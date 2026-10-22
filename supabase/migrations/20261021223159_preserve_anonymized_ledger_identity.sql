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
