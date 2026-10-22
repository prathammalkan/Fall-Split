# Fall Split production database repair plan

## Status: blocked; no production DDL authorized or executed

This runbook reconciles the production findings and repository artifacts as of
2026-10-22. It is an operational plan, not an executable SQL bundle. The
production database still lacks `public.is_active_account()`,
`create_group_with_owner(...)`, and `update_expense_with_records(...)`; its
`expenses_participant_select` policy has the confirmed payer/share alias defect;
and `supabase_migrations.schema_migrations` is absent. No production SQL is
included here for direct execution.

The current branch is `main` at `4265e23`. The existing untracked
`install_atomic_group_and_expense_edit.sql` is preserved, but it is not a safe
production repair: its preflight correctly aborts when the active-account
helper is absent, and it does not repair the broader policy, grants, wrappers,
or migration baseline.

## Reviewed artifacts and composition gap

- `migrations/001_core_schema.sql` through `012_security_definer_hardening.sql`
  are the historical baseline. The production ledger is empty, which proves
  neither that these SQL files ran nor that all of their effects remain.
- `migrations/013_security_financial_reconciliation.sql` through
  `018_atomic_itemized_expense_creation.sql`, plus
  `20261021223159_preserve_anonymized_ledger_identity.sql` and
  `20261021225434_revoke_excessive_app_table_privileges.sql`, are the reviewed
  forward repair sequence represented in `FINAL_SUPABASE_REPAIR.sql`.
- `20261022143545_atomic_group_creation_and_expense_edit.sql` adds the two RPCs
  actually called by the UI. It is not included in `FINAL_SUPABASE_REPAIR.sql`.
  The standalone installer is a different transaction and assumes that
  migration 014's helper already exists. Combining the files by pasting the
  standalone installer unchanged would leave nested transaction boundaries
  and an out-of-order helper preflight.
- The repository therefore has 21 migration files, while the validation report
  records a fresh run of 20 files and a successful run of the consolidated
  repair on a representative PostgreSQL 17.11 fixture. That is valuable local
  evidence, but it does not validate migration 20261022143545, the combined
  21-file repair, Supabase Auth/PostgREST, or the exact current production
  catalog.
- The reconciliation overview and repair readme describe the repair as
  unvalidated / no-go, while the later validation report records a successful
  representative-fixture run. The precise status is: local PostgreSQL
  representative-fixture validation passed for the then-current 20-file
  package; production equivalence and Supabase-specific validation did not.
- The existing operator sequence also says to reconstruct the migration ledger
  before running `FINAL_SUPABASE_REPAIR.sql`, but that script explicitly aborts
  if the ledger exists. Do not follow that sequence literally. The SQL bundle,
  ledger baseline steps, and deployment order must be revised and re-tested
  together before production use.

## Ordered repository migration inventory

| Order | Migration                                                   | Main effect / dependency                                                                                                            |
| ----: | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
|     1 | `001_core_schema.sql`                                       | Types, tables, constraints, indexes, timestamp/Auth signup triggers; requires Supabase Auth and extensions.                         |
|     2 | `002_rls_policies.sql`                                      | RLS policies and relationship helpers on the 001 schema.                                                                            |
|     3 | `003_functions.sql`                                         | Invitation acceptance and friend-balance RPCs.                                                                                      |
|     4 | `004_settlements_rejected_at.sql`                           | Settlement rejection state, depends on settlements from 001.                                                                        |
|     5 | `005_fix_friend_balances.sql`                               | Reconciles payer/share balance calculation.                                                                                         |
|     6 | `006_fix_accept_invitation_and_group_balances.sql`          | Invitation and group-balance corrections.                                                                                           |
|     7 | `007_sync_schema_columns.sql`                               | Client/schema column alignment.                                                                                                     |
|     8 | `008_delete_account_rpc.sql`                                | Initial account anonymization RPC, later replaced by 013/014.                                                                       |
|     9 | `009_settlement_integrity.sql`                              | Settlement transition trigger and proposal/response/cancel RPCs.                                                                    |
|    10 | `010_invitation_preview.sql`                                | Intentionally public safe invitation preview.                                                                                       |
|    11 | `011_group_balance_membership_guard.sql`                    | Membership-bound group balance access.                                                                                              |
|    12 | `012_security_definer_hardening.sql`                        | Legacy function search-path and grant hardening; live definitions still require comparison.                                         |
|    13 | `013_security_financial_reconciliation.sql`                 | Profile least privilege, profile/UPI and balance RPCs, pair allocations, caller-bound helpers/grants; depends on 001–012 contracts. |
|    14 | `014_active_account_enforcement.sql`                        | Active-account helper, restrictive policies, write guards and guarded wrappers; depends on 013.                                     |
|    15 | `015_relationship_authorization.sql`                        | Friend-request and group-invitation write authorization; depends on 013/014 policies and helpers.                                   |
|    16 | `016_atomic_expense_creation.sql`                           | Idempotent atomic expense, payer and share persistence; depends on 014 and expense tables.                                          |
|    17 | `017_fix_expense_participant_visibility.sql`                | Corrects payer/share predicates on the existing expenses policy.                                                                    |
|    18 | `018_atomic_itemized_expense_creation.sql`                  | Itemized lines, allocations, retry reconciliation; depends on 016 and item tables.                                                  |
|    19 | `20261021223159_preserve_anonymized_ledger_identity.sql`    | Removes profile→Auth cascade only after exact FK assertions; depends on 014 deletion semantics.                                     |
|    20 | `20261021225434_revoke_excessive_app_table_privileges.sql`  | Removes anonymous/high-risk app-table privileges and tightens `postgres` defaults; expects all 17 tables and PostgreSQL 17.         |
|    21 | `20261022143545_atomic_group_creation_and_expense_edit.sql` | Adds the two UI RPCs; depends on 014 helper, group/expense schemas, enums, constraints, and settlement pair-lock convention.        |

This inventory is the ordered source chain, not proof those versions are
recorded or applied in production. The first 12 entries require effect-level
reconciliation; the last nine are intended forward repairs and must be tested
as a complete set against the exact baseline.

## Frontend RPC contract and required security properties

| Frontend call                                                        | Signature and effect                                                                                                                                                                                                | Required authorization and consistency                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CreateGroupPage.tsx` → `create_group_with_owner`                    | `(text,text,public.group_type) returns uuid`; inserts the group and its owner/admin membership atomically                                                                                                           | Bind to `auth.uid()`, require active account, reject invalid text/type, fixed `search_path`, RLS handling intentional, revoke `PUBLIC`/`anon`, grant only `authenticated`                                                                                                                  |
| `EditExpensePage.tsx` → `update_expense_with_records`                | `(uuid,timestamptz,text,bigint,date,text,text) returns uuid`; edits header and, for supported amount changes, payer/share rows                                                                                      | Bind to active creator, compare expected `updated_at`, reject invalid/stale/non-equal changes, preserve positive payer minimums and payer/share totals, reject amount changes for itemized expenses, use deterministic pair advisory locks before expense row lock, private execute grants |
| `AddExpensePage.tsx` / offline queue → `create_expense_with_records` | `(jsonb,jsonb,jsonb) returns uuid`                                                                                                                                                                                  | Migration 016; atomic header/payer/share write, idempotency and caller authorization                                                                                                                                                                                                       |
| Offline queue → `create_itemized_expense_with_records`               | `(jsonb,jsonb,jsonb,jsonb) returns uuid`                                                                                                                                                                            | Migration 018; atomic line items/allocations and share reconciliation                                                                                                                                                                                                                      |
| Auth/profile, friend, settlement, invitation pages                   | `get_profile_for_user`, `get_friend_balances`, `get_settlement_recipient_upis`, `propose_settlement`, `respond_to_settlement`, `cancel_settlement`, `accept_invitation`, `get_invitation_preview`, `delete_account` | Reconciled/secured by 013–014; only invitation preview is intentionally callable by `anon`; verify exact definitions and ACLs, not just names                                                                                                                                              |
| Supabase integration tests                                           | `are_friends` and the private RPCs above                                                                                                                                                                            | Negative tests must prove anonymous execution is denied and caller-bound helper/RPC attempts cannot act for another user                                                                                                                                                                   |

Both new RPCs use `SECURITY DEFINER`, so their final definitions must retain
fixed search paths, caller identity checks, an active-account check, and narrow
execute grants. The active-account helper must be the reviewed caller-bound
implementation from 014, owned by a role able to read `profiles` under RLS;
do not create an always-true shim or remove the check. Migration 017 must
compare `payer.expense_id` and `share.expense_id` with `expenses.id`.

The edit migration orders pair advisory locks before the expense row lock.
Settlement RPCs in 009 likewise acquire the pair lock before `FOR UPDATE` on
the settlement row; retain that order and test edit-vs-confirm/cancel races with
two independent sessions. Equal-split edits must not rewrite itemized line
allocations. The current SQL rejects changing an itemized expense's amount;
that behavior is intentionally safer than leaving lines inconsistent.

## Preconditions: all are hard stops

1. **Target and operator:** independently confirm the Supabase Dashboard project
   is `Fall-Split`, ref `qkmswepfvgguomfhmkvg`, expected region and PostgreSQL
   17.11. Confirm the linked CLI/MCP target and SQL operator role. SQL identity
   alone cannot establish the project ref. No `.env.local` values are needed in
   chat or this file.
2. **Fresh backup:** create a current recoverable database backup/snapshot and
   preserve schema/function/policy/grant definitions. Record the backup ID,
   timestamp, retention and restore procedure. Prove restore into a disposable
   project before touching production. A prior report says no backup was kept
   for an earlier data deletion; it is not evidence of a current backup.
3. **Maintenance barrier:** block PostgREST/RPC and Edge Function traffic at an
   externally enforced API/proxy boundary, including cached/old clients. Verify
   denial from a separate client while keeping the migration path available.
   A frontend maintenance page or hiding routes is insufficient. If the
   barrier cannot be enforced, stop.
4. **Schema reconciliation:** obtain a fresh catalog export and compare every
   effect of 001–012 (columns, types/enums, defaults, constraints, indexes,
   triggers, functions/bodies/config/owners/ACLs, grants and RLS policies).
   For each version record `present`, `superseded`, `drift covered by forward
repair`, `missing`, or `unresolved`, with query evidence. Stop on any
   unexplained difference. Historical migration files must not be replayed on
   top of existing objects.
5. **Policy/privilege review:** capture all 36 audited baseline policy
   definitions and current table/default/function ACLs. Recompute the policy
   fingerprints used by `FINAL_SUPABASE_REPAIR.sql`; a changed fingerprint is
   a stop-and-reconcile condition, not a reason to weaken the preflight.
6. **Runner validation:** test the _final combined artifact_ through the exact
   intended migration runner in a disposable Supabase-compatible PostgreSQL
   17 environment, including timeout, failure-before-commit rollback, and
   postflight. Dashboard SQL Editor semantics were not validated by the earlier
   local PostgreSQL run.
7. **PostgreSQL 17.11 advisory:** separately check whether the project uses
   affected `ltree` indexes/values, legacy `pgcrypto` ciphers, `btree_gist`
   float indexes containing `NaN`, or custom operators with non-built-in
   estimators, following the [Supabase 17.11 upgrade checks](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
   These are separate maintenance items; do not add a reindex or data rewrite
   to this application repair transaction without its own plan and backup.
8. **Ledger plan:** do not hand-create `supabase_migrations` objects or invent
   rows. Do not run `db push` while the ledger is absent: it may try to apply
   the old 001–012 files. After effect-by-effect baseline reconciliation,
   validate the supported CLI `migration repair` bookkeeping procedure in a
   disposable clone. Record a version only when its complete effect is
   evidenced present or explicitly superseded by a reviewed forward migration.
   Re-list and verify the resulting ledger before any future `db push`.

## Required final repair bundle and execution order

Do not run either current manual SQL file as-is in production. Prepare and
review one fail-closed transactional bundle that includes:

1. The preflight and forward repair from `FINAL_SUPABASE_REPAIR.sql` for
   migrations 013–018 and both timestamped repairs. It must verify the exact
   audited baseline, all 17 app tables, required columns/types, 36 policies,
   triggers, constraints, legacy function signatures/ACLs, FK state, and role
   ownership before DDL.
2. The exact two function bodies and narrow grants from
   `20261022143545_atomic_group_creation_and_expense_edit.sql`, inserted after
   014 has installed `is_active_account()` and before shared postflight. Adapt
   the function preflight to validate the _expected absent state before the
   transaction_, not to require the helper before the bundle creates it. Add
   both RPC signatures, owner/config/ACLs, financial reconciliation and stale
   write outcomes to postflight. Preserve one outer `BEGIN`/`COMMIT`; do not
   splice the standalone file's `BEGIN`/`COMMIT` or skip its checks.
3. Correct `expenses_participant_select` exactly as in 017, verify its
   `USING` predicate against the outer `expenses.id`, and include a direct
   participant/nonparticipant RLS test in the isolated suite.
4. Grants/default privileges and profile/Auth retention behavior exactly as
   covered by 013, 014 and the two timestamped repairs. No grants to `anon` for
   private RPCs; preserve only the explicitly intended public invitation
   preview. Do not alter Supabase-managed schemas or Auth objects.
5. Bounded lock/statement timeouts, a clear preflight exception before any DDL,
   transaction-wide postflight assertions, and a success marker emitted only
   after all assertions pass.

The bundle should not write application rows. Its catalog changes are
transactional in the tested PostgreSQL path, but that does not prove a Dashboard
SQL Editor timeout rolls back. Keep the externally verified barrier until the
database postflight, migration-history reconciliation, and smoke tests finish.

## Read-only preflight SQL

Run these queries only after independently selecting the project; they are
diagnostic and do not modify schema or data. Expected project database is
`postgres`, role should match the reviewed migration operator, and server major
version should be 17.

```sql
SELECT current_database() AS database_name,
       current_user AS operator_role,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('server_version') AS server_version,
       current_setting('server_version_num')::integer / 10000 AS server_major;

SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_ledger,
       to_regprocedure('public.is_active_account()') AS active_account_helper,
       to_regprocedure('public.create_group_with_owner(text,text,public.group_type)') AS create_group_rpc,
       to_regprocedure('public.update_expense_with_records(uuid,timestamp with time zone,text,bigint,date,text,text)') AS edit_expense_rpc;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('expenses','groups','group_members','expense_payers','expense_shares','expense_items')
ORDER BY tablename, policyname;

SELECT p.oid::regprocedure AS signature,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       p.proacl AS function_acl
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_active_account','create_group_with_owner',
                    'update_expense_with_records','propose_settlement',
                    'respond_to_settlement','cancel_settlement')
ORDER BY p.oid::regprocedure::text;
```

Also export `pg_get_functiondef`, constraints, index definitions, trigger
definitions, column grants, relation grants, default ACLs, and the full policy
catalog to a protected review artifact. Never paste credentials or JWTs into
the SQL or report. The earlier observed production state is time-bounded and
must be refreshed after the backup/barrier are confirmed.

## Isolated validation matrix before production review

- Apply all 21 repository migration files to a fresh PostgreSQL 17.11 fixture
  with the minimal Auth shim; report this as PostgreSQL-only.
- Apply the combined repair to a clone of the reconciled production baseline;
  require all baseline assertions, then inject a failure immediately before
  commit and compare catalogs to prove rollback. Verify a rerun fails before
  DDL rather than silently replacing objects.
- Test active and tombstoned callers; anonymous calls to every private helper
  and mutation RPC; caller-spoof/cross-user group, expense, profile, invitation
  and settlement attempts; owner/member boundaries; direct table RLS; and
  `anon`/`authenticated` table/function/default privileges.
- Test group+owner atomicity, valid/invalid group inputs, and uniqueness.
- Test equal expense edits including multiple payers, 1-paise/minimum totals,
  deterministic paise allocation, payer/share sums, unchanged amount edits,
  non-equal split rejection, itemized amount rejection, invalid-input rollback,
  and stale timestamp error (`40001`). Verify header, payer, share, item and
  allocation rows after each case.
- Test edit against settlement propose/respond/cancel with two independent
  sessions. Both operations must commit or produce intentional domain/stale
  errors; no deadlock or half-updated ledger. Preserve settlement
  authorization, balance checks, state transitions and idempotency.
- Run the six opt-in Supabase API integration tests only on a disposable
  Supabase project with throwaway Auth users; local Auth shims do not validate
  Supabase Auth, PostgREST, hosted JWT claims, or production RLS.

## Postflight verification SQL

After successful isolated validation and later an approved production run,
require zero rows from all failure probes and capture the returned definitions:

```sql
SELECT to_regprocedure('public.is_active_account()') IS NULL AS helper_missing,
       to_regprocedure('public.create_group_with_owner(text,text,public.group_type)') IS NULL AS group_rpc_missing,
       to_regprocedure('public.update_expense_with_records(uuid,timestamp with time zone,text,bigint,date,text,text)') IS NULL AS edit_rpc_missing;

SELECT p.oid::regprocedure AS signature,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,
       p.proconfig,
       p.proacl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_active_account','create_group_with_owner',
                    'update_expense_with_records');

SELECT policyname, qual
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'expenses'
  AND policyname = 'expenses_participant_select';

SELECT relation.relname AS table_name,
       relation.relrowsecurity AS row_security_enabled,
       relation.relforcerowsecurity AS row_security_forced
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
WHERE schema.nspname = 'public'
  AND relation.relkind IN ('r','p')
ORDER BY relation.relname;

SELECT count(*) AS active_account_policy_count
FROM pg_catalog.pg_policy AS policy
JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
WHERE schema.nspname = 'public'
  AND relation.relkind IN ('r','p')
  AND policy.polname = 'active_account_required'
  AND NOT policy.polpermissive
  AND policy.polcmd = '*'
  AND to_regrole('authenticated') = ANY(policy.polroles);

SELECT count(*) AS active_account_write_guard_count
FROM pg_catalog.pg_trigger AS trigger_row
JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
WHERE schema.nspname = 'public'
  AND relation.relkind IN ('r','p')
  AND trigger_row.tgname = 'active_account_write_guard'
  AND NOT trigger_row.tgisinternal
  AND trigger_row.tgenabled <> 'D';

SELECT relation.relname AS table_name, roles.role_name, privilege.privilege
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
CROSS JOIN (VALUES
  ('anon'::name, ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::text[]),
  ('authenticated'::name, ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::text[])
) AS roles(role_name, checked_privileges)
CROSS JOIN LATERAL unnest(roles.checked_privileges) AS privilege(privilege)
WHERE schema.nspname = 'public'
  AND relation.relkind IN ('r','p')
  AND has_table_privilege(roles.role_name, relation.oid, privilege.privilege)
ORDER BY relation.relname, roles.role_name, privilege.privilege;

SELECT schema.nspname AS schema_name, defaults.defaclobjtype, acl.grantee,
       acl.privilege_type
FROM pg_catalog.pg_default_acl AS defaults
JOIN pg_catalog.pg_namespace AS schema ON schema.oid = defaults.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
WHERE schema.nspname = 'public'
  AND defaults.defaclrole = to_regrole('postgres')
  AND defaults.defaclobjtype = 'r'
  AND (acl.grantee IN (0, to_regrole('anon'))
       OR (acl.grantee = to_regrole('authenticated')
           AND acl.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')));
```

Acceptance requires helper/RPC absence flags `false`; the two RPCs and helper
owned/configured as reviewed; no `PUBLIC`/`anon` execute path for private
functions; `authenticated` execute where intended; active-account policies and
write guards count exactly 17; all app tables have RLS enabled; the participant
policy compares payer and share expense IDs to `expenses.id`; the high-risk
privilege query returns zero rows; the profile Auth cascade is removed only
after its FK preflight; and all financial/RLS scenario assertions pass. Do not
infer that the full schema is secure from function existence alone.

## Failure and recovery

- **Before the transaction:** any target, backup, barrier, fingerprint, schema,
  privilege, owner, or extension mismatch is a hard stop. Reconcile; never edit
  out a failing preflight to make the run proceed.
- **During the transaction:** stop on the first error. Do not run the standalone
  installer and do not rerun the bundle. Check whether the runner reports a
  rolled-back transaction, then query the catalogs read-only to confirm no
  partial DDL. If SQL Editor timeout/cancellation leaves outcome uncertain,
  keep the barrier and reconcile state before a retry.
- **After commit, before ledger repair:** keep APIs blocked. Compare every
  postcondition. If the database differs, restore from the verified backup or
  use an independently reviewed forward correction; do not use a blanket down
  migration that restores known weak grants/policies.
- **Ledger:** only after SQL postflight passes, reconcile baseline versions with
  the supported Supabase migration CLI. Record each version only with evidence
  that its effect is present or covered by a later reviewed version. Verify
  the list again; never hand-create `schema_migrations`, invent timestamps,
  mark failed SQL as applied, or use `db push` to discover what executes.
- **After release:** retain backup and run artifacts; remove the API barrier
  only after history and security checks pass. If rollback is needed, restore
  the verified recovery point under a separately reviewed incident procedure,
  then reverify access control before reopening traffic.

## Vercel and PWA release checks

`vercel.json` builds the Vite app into `dist`, rewrites SPA routes, and defines
security headers. It previously set `Permissions-Policy: camera=()`, which
blocks the app's same-origin QR scanner. The working tree now changes this to
`camera=(self)` while keeping microphone and geolocation disabled. A public
read-only request to `https://fall-split.vercel.app/` still returned the old
`camera=(), microphone=(), geolocation=()` header with HTTP 200, so the current
deployment has not received this fix. That public response does not reveal its
source SHA.

Application build-time variable names from `src/lib/supabase.ts` and
`.env.example`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required;
`VITE_APP_URL` must be the production HTTPS origin for production invitation
links; `VITE_VAPID_PUBLIC_KEY` is needed for push subscription support.
`VITE_SENTRY_DSN` and `VITE_POSTHOG_KEY` are optional. Check presence in the
Vercel Production environment without reading or printing values.

The repository currently has no `.vercel/project.json` / `.vercel/repo.json`,
no installed Vercel CLI, and no Vercel MCP tools in this session. Therefore the
actual Vercel project link, production branch, production variable presence,
deployment status and deployed SHA remain unverified. Before any push that may
auto-deploy, verify the owner/project and production branch, then verify the
target commit and domain with authenticated Vercel tooling. Do not infer the
deployed SHA from the public page or stale dashboard screenshots. After the
database gates pass, deploy only the reviewed commit and verify its exact SHA,
assigned URL, login route, manifest and service worker. Authenticated journeys,
install/offline behavior and camera hardware still need real browser/device
coverage; unit mocks do not prove those integrations.

## Release gate

Production remains **NO-GO** until (1) the combined artifact is updated to
include the final RPC migration and ledger-order conflict is resolved, (2) all
21 migrations and rollback/failure tests pass on the isolated target, (3) fresh
production catalog reconciliation is complete, (4) a recoverable backup and
externally enforced API barrier are verified, (5) authorized production
execution and postflight complete, and (6) Supabase Auth/PostgREST tests pass.
Vercel project/branch/environment names/deployed SHA and authenticated/browser
PWA checks are separate gates; they remain unverified in the current session.
