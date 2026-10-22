# Fall Split consolidated Supabase repair

## Status: READY FOR ISOLATED SUPABASE TESTING

This is a review artifact for the existing Fall Split database, not a clean-install script and not suitable for production execution. It combines reviewed forward migrations with fail-closed preflight and postflight checks. It executed successfully on a disposable PostgreSQL 17.11 cluster against a representative baseline fixture with a minimal Auth shim; it has not been run against Supabase Auth, PostgREST, the Dashboard SQL Editor, or a full clone of production.

Do not run it against production yet. The production migration history is empty while application objects already exist. Reconcile migrations `001`-`012` effect-by-effect; do not replay them. This file does not create, repair, or modify the migration ledger.

## Included sequence and effects

1. `013_security_financial_reconciliation.sql` — caller-bound profile/UPI and balance RPCs, profile column privileges, discoverability view, settlement and financial reconciliation.
2. `014_active_account_enforcement.sql` — active-account helper, restrictive RLS policies, write guards, and active-account RPC wrappers.
3. `015_relationship_authorization.sql` — pending-only friend-request creation and group-invitation integrity.
4. `016_atomic_expense_creation.sql` — atomic, idempotent expense, payer, and share persistence.
5. `017_fix_expense_participant_visibility.sql` — corrects payer/share visibility to compare with the outer expense.
6. `018_atomic_itemized_expense_creation.sql` — atomic itemized line/allocation persistence and retry reconciliation.
7. `20261021223159_preserve_anonymized_ledger_identity.sql` — detaches Auth deletion from retained pseudonymous ledger identity, guarded by FK assertions.
8. `20261021225434_revoke_excessive_app_table_privileges.sql` — removes direct `PUBLIC`/`anon` table grants, removes `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17 `MAINTAIN` from `authenticated`, and narrows future table defaults for `postgres`.

The SQL does not intentionally insert, update, or delete app rows. It does not delete Auth users, drop tables/schemas, reset the database, or alter Supabase-managed schemas, project settings, or migration metadata. The account-deletion Edge Function is not deployed by SQL. Default privileges for `supabase_admin` are not changed.

## Preconditions and audited assumptions

The current read-only audit found the existing project `Fall-Split` (`qkmswepfvgguomfhmkvg`, PostgreSQL 17.11), 17 public app tables with RLS enabled, an empty migration list, no `supabase_migrations.schema_migrations` table, and a 36-policy baseline. The only public FK to `auth.users` was `profiles.id` with `ON DELETE CASCADE`. The live expense participant policy had the known alias bug. The function catalog lacked `get_profile_for_user`, `get_settlement_recipient_upis`, `create_expense_with_records`, and `create_itemized_expense_with_records`.

The preflight additionally requires the audited columns, legacy RPC signatures and return types, signup and settlement-history triggers, role `postgres`, PostgreSQL 17, and exact Auth FK state. It verifies all 36 baseline policies against PostgreSQL-catalog fingerprints that include schema/table/name, command, permissive/restrictive mode, role list, `USING`, and `WITH CHECK`; fingerprints were captured from a read-only catalog query against the audited PostgreSQL 17.11 project on 2026-10-22. The repaired expenses participant policy is deliberately not expected in the baseline; migration 017 replaces that known-buggy definition. It aborts on an existing migration ledger, evidence of a partial/repeated repair, duplicate item sort orders, an unexpected index definition, or public sequences. It cannot confirm which project is selected in the Dashboard; independently verify the ref before any testing. Any changed assumption means stop and reconcile rather than weaken the guard.

The script checks important final signatures, RLS and active-account policies/triggers, retention FKs, grants, SECURITY DEFINER search paths, and item-sort uniqueness. Policy fingerprints are compact hashes rather than human-readable expected expressions; retain the live catalog result in the validation report and review it before any production review. Function body equivalence is not fully fingerprinted; review function definitions, dependencies, owners, ACLs, and configuration against the source migrations in isolated testing.

## Transaction and rerun behavior

One explicit `BEGIN`/`COMMIT` wraps the preflight, all forward DDL, and postflight. The included DDL, function/policy changes, grants, regular index creation, and FK removal are transaction-capable; `NOTIFY pgrst` takes effect at commit. No concurrent index build or provider operation is included. `lock_timeout` and `statement_timeout` are bounded. A failed assertion raises an error within the transaction.

Run the whole file as one batch. Do not select sections individually or remove guards. It is intentionally **one-shot**, not rerun-safe; after success, preflight detects repair objects. On failure or timeout, stop, check database logs and transaction outcome, then inspect the schema before considering a retry.

The Dashboard SQL Editor has an execution timeout, and its handling of this multi-statement transaction has not been validated here. First test the complete file through the same SQL Editor path in a disposable PostgreSQL 17/Supabase environment, including rollback behavior of a failing copy. Never test rollback on production. Do not split the script into piecemeal production changes if the editor cannot run it as one transaction.

## Isolated execution and verification

1. Select an approved disposable PostgreSQL 17/Supabase environment, not the retained production project.
2. Verify its identity independently and take a recoverable backup of that disposable target.
3. Re-run read-only catalog checks and confirm all preflight assumptions, including the policy inventory and exact function signatures.
4. Execute the complete SQL in one Dashboard SQL Editor request. Confirm successful `COMMIT` and the postflight notice; on error, stop and inspect logs/state.
5. Re-query policies, functions, triggers, constraints, indexes, table/function privileges, and search paths. Compare against expected effects.
6. Run integration tests with explicitly disposable identities. Verify RLS denial cases, balance/payer/share totals, itemized expense behavior, idempotency, settlement concurrency, and account-retention behavior from resulting rows, not only RPC responses.
7. Reconcile historical migration versions separately and establish a truthful supported migration baseline. Do not mark migrations applied just to bypass errors.

PostgreSQL 17.11 local validation is available. All 20 repository migration files passed on a fresh disposable database using a minimal Auth shim. The consolidated repair passed against a migrations-001–012 baseline fixture whose 36 RLS policy fingerprints matched the audited baseline. Two defects found during first execution were fixed (a wrong item-allocation alias and an unsafe absent-index `regclass` cast), then the entire repair passed. An injected pre-COMMIT exception rolled back the schema; rerun was rejected before DDL. Local RPC smoke covered regular/itemized expense persistence, conservation, retry idempotency, spoof rejection, and itemized failure rollback; an RLS smoke covered profile visibility and private UPI denial. This is not Supabase runtime validation. Fresh app verification on 2026-10-22: 15 test files; 159 passed, 6 skipped, 0 failed; typecheck, lint, format, audit (0 vulnerabilities), build (2,428 modules), PWA artifacts, and `git diff --check` passed. The six skipped API tests still require an isolated Supabase stack. The pinned Supabase CLI is available with `npm exec supabase`, but local startup is blocked until Docker is installed. The owner reports the historical database password has been rotated; history cleanup remains outstanding.

## Failures, irreversibility, and remaining work

Preflight failure means the database differs from the audited baseline. Migration errors must abort the explicit transaction if the editor preserves it. Postflight errors mean the expected state was not reached; do not expose application traffic or apply ad hoc fixes. Capture failing statements and logs without secrets.

The file does not intentionally rewrite application rows, but schema/security changes are not automatically reversible. Restoring old broad grants, policies, function bodies, or the Auth cascade can restore known vulnerabilities or break retention. Prefer a reviewed forward correction. The earlier production wipe had no retained backup; code or SQL rollback cannot restore the deleted records.

Still outside SQL: deploy and verify the `delete-account` Edge Function; verify Google OAuth and Supabase email/SMTP settings; the owner reports the database password exposed in Git history has been rotated, so verify authorized direct-connection consumers use the replacement without displaying it; coordinate history cleanup and collaborator clone refresh before publication; reauthenticate Vercel and verify its domain, variables, headers, and Git integration; and perform browser/device PWA checks. Do not rotate again absent evidence the replacement was exposed. Before any production DDL, verify a recoverable backup, reconcile the baseline, enforce an API/Edge Function maintenance barrier, and obtain separate explicit authorization. New users may have signed up since the last zero-row audit.

## Recommendation

**NO-GO for production execution.** It is ready for isolated Supabase-specific validation. Full production-schema equivalence, Supabase Auth/PostgREST and SQL Editor behavior, broader database integration tests, and external release blockers remain unresolved.
