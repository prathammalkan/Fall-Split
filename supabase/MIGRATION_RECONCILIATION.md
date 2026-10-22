# Supabase migration reconciliation

## Current state

On 2026-10-22, after the user's explicit confirmation, all rows in the 17
application-owned `public` tables and all 3 Supabase Auth users were deleted.
The deletion was verified with zero row counts in those tables and zero Auth
users. No Storage buckets or objects existed. No backup was retained, as
directed. Supabase-managed schemas and project/provider configuration were
preserved. The application schema remains in place and still needs
reconciliation.

The read-only audit found the Fall Split application objects in the audited
database, but did not find `supabase_migrations.schema_migrations`. The
`auth.schema_migrations` table is Supabase-internal history and is not evidence
that repository migrations `001`-`012` were applied. The legacy
`scripts/run-migrations.mjs` runner only knew migrations `001`-`003`, had no
authoritative ledger, and retried selected statement errors. It was removed
during repository hardening; do not recreate or use it as a migration workflow.

Migrations `013_security_financial_reconciliation.sql` through
`018_atomic_itemized_expense_creation.sql` have not been applied to the
retained project. Migration 015 closes direct friend-request status escalation
and unauthorized group-invitation paths; 016 adds atomic expense and
payer/share persistence; 017 fixes participant visibility; and 018 adds atomic
itemized persistence and retry reconciliation. No historical migration should
be replayed based only on a missing ledger or matching object names.

The owner selected the existing project and explicitly prohibited creating a
replacement project. The data wipe did not authorize dropping application
objects or applying schema migrations. The procedure below is for the retained
database whose application objects predate the repository migration ledger.

`manual/FINAL_SUPABASE_REPAIR.sql` is a consolidated review artifact containing
the forward chain and fail-closed checks; it is **NOT VALIDATED**. Its preflight
matches the currently audited schema/policy inventory and now fingerprints
complete baseline policy definitions. `pglast 7.21` accepted the consolidated
SQL using PostgreSQL 17.7 grammar, but it has not been run on a PostgreSQL
server or validated in an isolated project. Do not execute it in production. See
[`manual/FINAL_SUPABASE_REPAIR_README.md`](manual/FINAL_SUPABASE_REPAIR_README.md)
and [`manual/FINAL_SUPABASE_REPAIR_VALIDATION_REPORT.md`](manual/FINAL_SUPABASE_REPAIR_VALIDATION_REPORT.md)
for assumptions, exact test results, and remaining validation requirements.

### Current read-only production catalog findings (2026-10-22)

Supabase's supported project and migration-list tools identify the retained
project as `Fall-Split` (`qkmswepfvgguomfhmkvg`, `ap-northeast-2`, Postgres
17.11) and return an empty migration list. The CLI confirms it is linked to
that project but cannot inspect a local database because neither Docker nor
Podman is installed. No schema or data mutation was made during this audit.

The public catalog confirms all 17 application tables exist and have RLS
enabled, with zero rows. `profiles_id_fkey` is the only `public` foreign key
directly referencing `auth.users`; it is `ON DELETE CASCADE`. The catalog also
confirms these production differences from the intended frontend contract:

- `get_profile_for_user`, `get_settlement_recipient_upis`,
  `create_expense_with_records`, and
  `create_itemized_expense_with_records` are absent, although frontend code
  invokes them.
- The live `expenses_participant_select` policy compares `ep.expense_id` to
  `ep.id` and `es.expense_id` to `es.id` rather than to the outer expense row.
  Migration 017 corrects these predicates locally.
- Existing application `SECURITY DEFINER` routines have
  `search_path=public`; catalog ACLs show `anon` can execute internal helpers
  and mutation routines in addition to the intended public invitation preview.
  RLS and function-body authorization still require scenario testing; these
  catalog facts alone do not prove an anonymous data read or mutation.
- Anonymous and authenticated roles have table privileges on application
  tables, including `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17
  `MAINTAIN` on all 17 app tables. RLS does not filter table-wide `TRUNCATE`
  or `REFERENCES`. The newly prepared
  `20261021225434_revoke_excessive_app_table_privileges.sql` removes direct
  `PUBLIC` and `anon` table grants, revokes those whole-table privileges from
  `authenticated`, and narrows future `postgres`-owned table defaults. It has
  not been applied or run against PostgreSQL.
- Migration 013 narrows profile column access and adds the
  `discoverable_profiles` view; this is not live.
- Supabase reports no deployed Edge Functions, including `delete-account`.

The application data is currently empty, but new users could sign up while the
schema is in this state. These contract and authorization differences block a
release. Do not apply individual fixes directly to production; reconcile and
test the reviewed chain as a unit under the maintenance plan below.

## Migration and dependency matrix

The sequence below is the repository's intended clean-install order. Every
historical migration must still be reconciled against production individually;
an empty remote ledger is not evidence that any version is missing from the
schema.

| Migration | Role / effect | Depends on | Reconciliation notes |
|---|---|---|---|
| `001_core_schema.sql` | Fresh-schema baseline: app types, tables, constraints, indexes, timestamp and Auth signup triggers | Supabase-managed `auth.users`, extensions | Existing remote app objects show a schema is present; compare full definitions. Do not replay. |
| `002_rls_policies.sql` | Enables RLS and creates initial policies and relationship helpers | 001 | Compare each policy, helper body, and table grant; remote RLS enabled does not prove policy correctness. |
| `003_functions.sql` | Invitation acceptance and initial friend balance RPCs | 001–002 | Verify signatures, bodies, and ACLs. |
| `004_settlements_rejected_at.sql` | Adds settlement rejection state/timestamp | 001 | Check enum/column/constraint state before any reconciliation. |
| `005_fix_friend_balances.sql` | Replaces friend-balance calculation for payer/share history | 001–003 | Live function is known to differ; migration 013 replaces the financial calculation. |
| `006_fix_accept_invitation_and_group_balances.sql` | Corrects invitation acceptance and group-balance RPCs | 001–005 | Compare exact routines and role checks. |
| `007_sync_schema_columns.sql` | Aligns application columns with the client schema | 001–006 | Reconcile column types, nullability, defaults, and constraints, not names alone. |
| `008_delete_account_rpc.sql` | Adds account anonymization RPC | 001–007 | Later replaced by 013/014; inspect its present body and effects. |
| `009_settlement_integrity.sql` | Adds settlement lifecycle validation and RPC integrity | 001–008 | Verify triggers, constraints, and exact RPC signatures. |
| `010_invitation_preview.sql` | Adds safe pre-auth invitation preview | 001–009 | Public preview is intentional; only approved fields should be returned. |
| `011_group_balance_membership_guard.sql` | Restricts group-balance reads to group membership | 001–010 | Compare both helper logic and exposed grants. |
| `012_security_definer_hardening.sql` | Pins search paths and adjusts function grants | 001–011 | Existing functions still show `search_path=public`; do not claim this migration is applied. |
| `013_security_financial_reconciliation.sql` | Profile least privilege/view, profile and UPI RPCs, balance allocation, caller-bound helpers, grants/search paths | 001–012 objects and exact legacy signatures | Forward reconciliation; creates/replaces reviewed objects. Requires staged owner, ACL, and balance checks. |
| `014_active_account_enforcement.sql` | Tombstone-aware RLS/write guards and public RPC wrappers | 013 | Renames internal functions and relies on effective owner bypassing profile RLS; validate all function owners and grants. |
| `015_relationship_authorization.sql` | Restricts friend-request transitions and group invitation creation/update | 013–014 policies/helpers and invitation schema | Test direct writes and admin/member boundaries. |
| `016_atomic_expense_creation.sql` | Atomic, retryable expense/payer/share RPC | 014 and core expense tables/types | Database-backed failure, idempotency, and conservation tests required. |
| `017_fix_expense_participant_visibility.sql` | Corrects payer/share participant visibility predicates | 002 policy name and expense tables | Live policy has the alias bug described above. |
| `018_atomic_itemized_expense_creation.sql` | Atomic itemized rows/allocations and retry reconciliation | 016 and itemized tables | Verify item-to-share totals and retry conflicts on PostgreSQL. |
| `20261021223159_preserve_anonymized_ledger_identity.sql` | Removes the Auth-to-profile cascade while preserving tombstoned ledger identity | 001 profile FK and 014 deletion flow | Its fail-closed FK assertions match the current catalog but have not run on PostgreSQL. |
| `20261021225434_revoke_excessive_app_table_privileges.sql` | Removes direct anonymous table grants and high-risk direct privileges; tightens future app-table defaults | All 17 application tables owned by `postgres`; PostgreSQL 17 | Latest forward-only grant repair; inherited `PUBLIC` grants and Data API behavior still need disposable database tests. |

Fresh initialization means applying the entire ordered chain to a disposable,
empty Supabase-compatible database. Existing-project reconciliation means
comparing 001–012 against the retained schema, establishing an evidence-backed
baseline, then applying only reviewed forward migrations 013–018 and the
retention and privilege migrations. Supabase-managed schemas (`auth`, `storage`, `realtime`,
`extensions`, `graphql_public`, and platform migration metadata) are not app
baseline migrations and must not be dropped, recreated, or overwritten.

The supported `db push` command applies all local versions missing from the
remote ledger and initializes that ledger when absent. Since this remote ledger
is empty, a normal push would consider 001–018 and both timestamped migrations
pending; many of those files create objects already present. Never use that
push as a schema-drift probe. First compare each historic migration's effects.
Only after that evidence exists may an operator use the supported migration
repair command to record versions that are demonstrably present or superseded;
this is a truthful, reviewed baseline operation, not a bypass for SQL errors.
Then list the remote history again and preview the reviewed forward set. Both
ledger bookkeeping and all production DDL require the separate final
authorization described in the task prompt.

## Required operator sequence

1. Confirm the retained project's display name, reference, region, API URL,
   and CLI link independently in the Supabase Dashboard. Do not create or
   substitute another Supabase project.
2. Take a recoverable database backup and preserve the current schema and
   function/policy definitions.
3. For every migration `001`-`012`, create a reviewed reconciliation record
   listing its expected objects/effects and one of these outcomes:
   `present`, `superseded`, `drift covered by 013`, `missing`, or `unresolved`.
   Compare definitions and privileges, not just object names. In particular,
   record the live stale `get_friend_balances()` implementation as drift covered
   by 013; do not claim migration 005's exact function body is present.
4. Stop if any effect is `missing` or `unresolved` and is not explicitly
   recreated by a reviewed forward-only migration. Do not fill the gap by
   executing an old migration file.
5. Run the migration-list command in read-only mode and verify that the CLI
   recognizes the repository's existing migration filenames. Reconstruct the
   ledger using Supabase's migration repair operation
   (`supabase migration repair --status applied <version>`), one verified
   version at a time, only after an operator-approved effect-by-effect
   reconciliation. This alters migration bookkeeping only; it must not execute
   migration SQL. Immediately re-list and verify that no historical `001`-`012`
   migration is pending. If the CLI cannot safely represent this baseline,
   stop; do not use `db push` to discover what runs.
6. Review migrations `013` through `018` and both timestamped forward fixes
   together against the reconciled baseline and take a fresh backup. The
   removed legacy runner had no migration ledger and retried selected errors
   statement-by-statement; it was not a safe path for this migration chain.
7. Before applying any of these migrations, establish an externally enforced
   maintenance barrier at the Supabase API/proxy boundary: block public
   PostgREST/RPC and Edge Function traffic, including callers using an old
   frontend bundle or direct API requests. A frontend maintenance page alone
   is not a barrier because clients can call Supabase directly. Preserve only
   the operator's database migration path. Verify the barrier from a separate
   client before starting and keep it in place until all migrations and the
   post-migration checks complete. If the hosting setup cannot enforce this
   barrier, stop and prepare a single reviewed transactional deployment unit;
   do not rely on filenames or sequential CLI output to prevent exposure.
8. Only after the backup, reconciliation, maintenance barrier, and operation
   approvals are verified, apply `013` through `018`, the account-retention
   migration, and the table-privilege migration to the retained project
   with the reviewed Supabase migration workflow. These are distinct migration
   files and do not contain a cross-file transaction. Migrations 016 and 018
   make their respective expense writes atomic; they do not make the migration
   chain one transaction. Do not claim the set is atomically applied unless
   the exact runner's behavior has been verified. The API barrier is required
   because intermediate migration states are not the final security state.
9. Verify the migration runner's role owns or bypasses RLS on
   `public.profiles`. The `is_active_account()` helper uses `SECURITY DEFINER`
   and `row_security = off` so it cannot recursively evaluate the profile
   policy; it intentionally fails closed if its owner cannot bypass RLS.
   Confirm effective owners and grants for renamed internal functions and
   public wrappers from PostgreSQL catalogs, rather than inferring them from
   source `CREATE FUNCTION` statements.
10. Run the authenticated RLS, field-privilege, account-deletion, multi-payer, and
settlement concurrency/idempotency checks only with explicitly approved
test identities and reversible fixtures. Verify resulting rows and balances,
not only API responses. Never run destructive account-deletion tests against
real user identities.
   The opt-in checks in `src/test/supabase.integration.test.ts` use a target
   explicitly marked disposable, verify the target Auth user's
   `app_metadata.disposable_test_identity` marker, and restore its profile,
   memberships, pending friend requests, and invitations in `finally` when its
   Auth identity still exists. On the success path, the test deletes that Auth
   identity after verifying the retained tombstone and expects the isolated
   test project to be disposed. Cleanup verifies restored row counts and reports
   returned errors. Profile `updated_at` is changed by the schema update
   trigger and cannot be restored through the ordinary API; do not describe
   cleanup as exact restoration. They reject target fixtures with
   payer-initiated pending settlements because settlement history forbids
   restoring those transitions. If Auth deletion unexpectedly succeeds,
   cleanup deliberately does not recreate the identity; the disposable-project
   safeguard is mandatory. The atomic-expense test adds isolated expenses and
   ledger rows to the staging project and does not remove them; reset/dispose of
   the test project after the suite. Opt in with
   `SUPABASE_DISPOSABLE_SECURITY_TESTS=1`
   and provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECURITY_TARGET_JWT`,
   `SUPABASE_SECURITY_TARGET_USER_ID`, `SUPABASE_SECURITY_ACTIVE_JWT`,
   `SUPABASE_SECURITY_ACTIVE_USER_ID`,
   `SUPABASE_SECURITY_PRIVATE_PROFILE_ID`,
   `SUPABASE_SECURITY_PRIVATE_GROUP_ID`, `SUPABASE_SECURITY_INVITATION_TOKEN`,
   `SUPABASE_SECURITY_RETAINED_EXPENSE_ID`,
   `SUPABASE_SECURITY_RETAINED_SETTLEMENT_ID`,
   `SUPABASE_SECURITY_DISPOSABLE_TARGET_ID`,
   `SUPABASE_SECURITY_TARGET_IS_DISPOSABLE=1`,
   `SUPABASE_DISPOSABLE_PROJECT_REF`, and
   `SUPABASE_DISPOSABLE_PROJECT_CONFIRMATION` (must exactly match the project
   ref), `SUPABASE_PRODUCTION_PROJECT_REF`, and
   `SUPABASE_SECURITY_AUTH_DELETE_CONFIRMATION=DELETE_AUTH_USER_<target-user-id>`.
   The disposable ref must differ from the separately configured production
   ref. For hosted projects, the URL hostname must match
   `<project-ref>.supabase.co`; local testing is restricted to port 54321.
   These checks are guards, not proof that an operator-configured project is
   disposable: independently confirm project identity and disposable status
   using the staging Dashboard and do not copy production values into this test
   environment. The target user must carry the disposable app-metadata marker.
   The private profile must not be a friend of the active user, the private
   group must not include the active user, and the expense must have at least
   two payers with payer and share totals equal to the expense amount.
11. Only after these pass, verify migrations `013`-`018` and both timestamped
   forward migrations are accurately
   recorded and document the retained project's rollback procedure. Do not
   switch projects as a workaround.

## Account-deletion retention design

Migration `001` defines `profiles.id` as `ON DELETE CASCADE` from `auth.users`,
but retained ledger tables reference `profiles.id` without cascading deletion.
The constraints that can block the profile cascade are:

- `groups_creator_id_fkey` (`groups.creator_id`)
- `group_members_invited_by_fkey` (`group_members.invited_by`)
- `expenses_creator_id_fkey` and `expenses_voided_by_fkey`
  (`expenses.creator_id`, `expenses.voided_by`)
- `expense_payers_user_id_fkey` (`expense_payers.user_id`)
- `expense_shares_user_id_fkey` (`expense_shares.user_id`)
- `expense_item_allocations_user_id_fkey` (`expense_item_allocations.user_id`)
- `expense_history_changed_by_fkey` (`expense_history.changed_by`)
- `settlements_payer_id_fkey` and `settlements_recipient_id_fkey`
  (`settlements.payer_id`, `settlements.recipient_id`)
- `activity_log_actor_id_fkey` (`activity_log.actor_id`)

The intended behavior is to preserve the anonymized `profiles` row and
all ledger references. Expenses, payer/share/item allocations, expense audit
history, and every settlement are retained. `delete_account()` cancels only
proposed/pending settlements initiated by the deleting payer; confirmed
settlements are not changed. It closes active memberships, cancels pending
friend requests, revokes the caller's invitations, then tombstones the profile
as its final update. The Edge Function attempts Auth deletion only after that
transaction commits and only if the profile is already tombstoned. The client
also clears that user's pending local offline expenses before attempting Auth
deletion. If local cleanup fails, it still completes Auth deletion and sign-out,
then tells the user to clear this site's local data before sharing the device.

Migration `20261021223159_preserve_anonymized_ledger_identity.sql` resolves the
Auth/profile cascade while retaining this ledger attribution: it fails closed
unless exactly one `profiles -> auth.users ON DELETE CASCADE` FK exists and no
other application table directly references `auth.users`, then removes that
single FK. Account closure first tombstones the profile and removes identifying
profile fields; only then does the server-side Edge Function delete the Auth
identity. Financial and audit rows continue to reference the anonymized profile.
The migration is prepared locally and has **not** been applied; the production
migration history is empty and needs a reviewed baseline/reconciliation plan
before any DDL is run.

Migration `014` still blocks a tombstoned identity from reading or writing app
data while its JWT remains valid. Supabase notes that deleting an Auth user does
not immediately invalidate existing JWTs, so this database check is required
until token expiry. Storage ownership also prevents Auth deletion; the live
project inventory showed no Storage objects at the time of inspection.

Migration `014` adds a caller-bound active-profile helper, restrictive RLS
policies for all application tables, write guards that also run for DML inside
`SECURITY DEFINER` functions, and wrappers that deny inactive callers access to
private profile and balance reads. Relationship helpers remain executable by
authenticated users because RLS calls them, but bind their user argument to
`auth.uid()`; anonymous execution remains revoked. Public invitation preview
is intentionally unchanged. Client sign-out is not the authorization control:
a stale JWT must be denied by the database.

## Retention and authorization verification still required

- Verify on a disposable Supabase branch that migration
  `20261021223159_preserve_anonymized_ledger_identity.sql` preserves a tombstoned
  profile and all ledger FKs after Auth-user deletion; verify the profile
  creation trigger still creates new profiles on sign-up.
- Verify in staging that the migration execution role owns or bypasses RLS on
  `public.profiles`; otherwise the active-account helper fails closed. Confirm
  `SECURITY DEFINER` owners, `search_path`, function execute grants, trigger
  behavior for `service_role`, and RLS behavior for the `security_invoker`
  discoverability view.
- Use the explicit opt-in integration tests only in a disposable project with
  throw-away identities. The test fixture must include an expense with at least
  two payers, a share for the target, an expense audit row, a confirmed
  settlement involving the target, an unrelated active user, a non-member
  private group, and a valid public invitation token. The target must have no
  proposed/pending settlements as payer because those cancellation transitions
  are intentionally not reversed during cleanup.

## Existing-project preflight checklist

Do not run destructive integration checks or apply migrations until each item
is independently confirmed:

- [ ] Confirm project ref, API URL, display name, and region in the Supabase
      Dashboard and verify that both app and database configuration point to
      this retained project. Do not create another project.
- [ ] Take a verified recoverable backup and document who can restore it and
      how restoration will be tested. Keep the account-retention decision and
      accepted destructive fixture risk explicit.
- [ ] Inspect live schema objects, constraints, policies, triggers, routines,
      signatures, owners, ACLs, and the migration ledger. Reconcile `001`-`012`
      individually; do not replay them and do not infer the baseline from
      object names.
- [ ] Confirm every table, type, policy, function signature, trigger, and grant
      referenced by 013/014 exists or is deliberately created by the reviewed
      forward-only migration. Confirm function overloads match exact signatures.
- [ ] Select the exact migration mechanism. Verify its per-file and
      cross-file transaction behavior and failure recovery; do not use an
      ad hoc SQL runner for migrations 013-018 or timestamped forward fixes.
- [ ] Enforce and independently test a maintenance barrier at the API/proxy
      boundary that blocks direct PostgREST/RPC and Edge Function requests,
      including old clients. A frontend maintenance page is insufficient.
      Preserve only the reviewed operator migration route; hold the barrier
      until post-migration grants, policies, triggers, and smoke tests pass.
- [ ] Confirm an authorized operator can inspect PostgreSQL function owners,
      ACLs, `proconfig`/search paths, RLS policies, trigger definitions,
      resulting rows, and financial balances. Specifically verify that the
      `is_active_account()` owner can read `profiles` with
      `row_security = off`, and that renamed internal functions remain
      executable by their wrappers' effective owners.
- [ ] Provision only approved test identities and fixtures. Verify target user ID,
      fixture ownership, at least two expense
      payers, participant shares, confirmed settlement, expense audit history,
      private group without the active actor, valid invitation token, and no
      payer-initiated pending settlement for target cleanup.
- [ ] Use the opt-in destructive integration suite only in an isolated local
      or otherwise explicitly authorized disposable environment. The suite's
      project-reference guard currently prevents targeting the retained
      production project. Keep keys in a protected secret store; never echo or
      include them in logs, test output, or reports.
- [ ] Stop if project identity, recoverable backup, schema/history, runner
      behavior, API barrier, catalog inspection capability, or fixture
      ownership is unverified.

## Database-backed test matrix

The integration suite is opt-in and has not run against PostgreSQL. Current
behavioral assertions are limited to the "Implemented locally" column; all
other rows remain required staging work. Static source-contract tests do not
count as database authorization evidence.

| Area | Implemented locally | Required staging assertion |
|---|---|---|
| Cross-user profile and relationships | Own profile, unrelated private-profile RPC, and caller-bound `are_friends` helper checks | Verify friend vs non-friend field visibility, deleted target behavior, arbitrary IDs in every relationship helper, and resulting privacy boundaries |
| Private group and balances | Non-member group read isolation | Check group balance RPC isolation, expense IDs/details/shares, nested joins, and member/admin role boundaries |
| Role changes and membership | No live test | Attempt self-promotion and changing another member's role/removal; assert errors/zero rows and unchanged admin-verified membership/roles |
| Anonymous access | Checks `are_friends`, settlement-UPI helper, and selected mutation RPCs; valid invitation preview | Attempt every internal helper and mutation RPC including `leave_group` and balance/profile functions; verify explicit grants and public-preview schema reveal only approved fields |
| Stale JWT | Deactivation then selected profile/expense/settlement reads and selected RPCs | Exercise SELECT/INSERT/UPDATE/DELETE against every one of the 17 gated tables and every exposed mutation/read RPC; inspect database rows and balances afterward |
| Account deletion | Snapshot and compare one expense, share, audit row, confirmed settlement; attempts Auth deletion | Cover all retained FKs and cleanup effects; verify Auth-delete partial failure and identity/profile state; verify existing confirmed settlement, all audit rows, and balances unchanged |
| Trigger trust paths | No database-backed check | Verify inactive JWT DML inside each security-definer routine is rejected; verify null `auth.uid()`, service-role, Auth signup trigger, and reviewed internal operations work only as intended |
| Invitation preview | Anonymous valid-token preview and internal helper denial | Check valid, expired, exhausted, revoked, deleted-creator, malformed, and random tokens; confirm response contains only invitation type and inviter display name |
| Friendship and group invitations | Static migration contracts cover pending-only direct requests, immutable request endpoints, and group-admin invitation checks | Verify direct accepted-friend inserts and request identity updates fail; only active group admins can create group invitations; an invite cannot be redeemed after its creator loses admin membership; inspect unchanged membership rows |
| Split allocation | Payer and share totals equal one fixture expense total | For equal, custom/unequal, percentage, weighted/shares, and itemized modes, vary participant/payer counts and awkward paise totals; inspect each payer-participant allocation and prove row/column totals and total conservation |
| Settlement authorization/history | Non-party response does not alter a confirmed fixture settlement | Verify payer-only cancellation, recipient-only response, invalid transitions, confirmed immutability, correct balance transition, and concurrent confirmations serialize to one valid result |
| Idempotency/concurrency | No live test | Concurrent identical proposal retries with one key produce one row/ID; conflicting retries fail; concurrent confirmation does not double-count; verify ledger rows and net balances |
| Offline expense recovery | Unit tests cover failed header/payer/share RPC responses, interrupted-queue recovery, lost responses, partial-header reconciliation, duplicate keys, conservation, and visible failures; itemized queue tests assert complete line-item payloads and explicit failure for legacy incomplete records | Verify migrations 016 and 018 on isolated PostgreSQL; test rollback of item/header/payer/share failures, retry repair/conflict behavior, idempotency, and exact financial totals |
| Cleanup | `finally` restores selected account state and verifies affected row counts | Confirm no touched state is omitted; profile `updated_at` remains changed by trigger. Any test creating immutable/append-only settlement rows must use a disposable project reset/restore, not claim API cleanup. |

The opt-in suite creates fresh expense fixtures for atomicity/retry checks, but
does not create a settlement fixture and does not cover all listed cases. It
has not run against PostgreSQL in this environment. Its destructive cases must
run only in an isolated local or explicitly authorized disposable environment;
the project schema is still production, though its application rows and Auth
users have been deleted. Do not use real user identities.

### Database acceptance criteria

1. Apply reviewed `013` through `018` and both timestamped forward migrations in
   the recorded order with a recoverable backup; verify the migration list and
   grants after each step.
2. Deactivate a disposable account that has expenses, shares, audit rows, and
   confirmed and pending settlements. Verify Auth deletion succeeds, the
   tombstoned profile and every financial/audit reference remain, confirmed
   settlement status is unchanged, and pending payer-initiated settlements are
   cancelled.
3. Reuse the pre-deactivation JWT for profile reads/updates, expense/history/
   settlement table access, balance/profile RPCs, and every exposed mutation
   RPC. Verify no private data is returned and no rows are changed.
4. Verify an active second user cannot retrieve private full-profile data for a
   non-friend, while expected public discoverability and public invitation
   preview continue to work.
5. Verify anonymous calls to internal relationship/settlement helpers fail,
   and authenticated helper calls cannot query on behalf of another user.
6. Verify an active user can still use invitations, group membership, expense
   creation/editing, balance reads, and settlement proposal/response flows.
   Check exact financial rows and balances, including multi-payer rounding and
   settlement concurrency/idempotency—not only RPC response values.
7. Current local integration scaffolding only checks that payer and share sums
   each equal an expense total, and checks a non-party response against an
   already-confirmed settlement without changing it. It does not verify the
   pairwise rounding matrix, a concurrently confirmed pending settlement,
   concurrent idempotent proposal retries, or cleanup of test-created
   append-only settlement rows. Add/run those cases with per-run disposable
   fixtures in staging; the confirmed-settlement immutability trigger prevents
   ordinary API cleanup, so dispose of or reset that staging project after
   those tests. Private-group and cross-user profile isolation are covered by
   read-only fixture checks but still require PostgreSQL execution.

## Rollback

Migrations `013`-`018` and both timestamped forward migrations do not intentionally rewrite existing financial rows,
but change policies, privileges, triggers, indexes, and function definitions. A
rollback must restore the captured pre-migration definitions and grants.
Recreating the old self-leave policy, broad profile grants, or unrestricted
relationship writes would restore known security defects; do not use a blanket
down migration. Prefer a forward corrective migration. Confirm the runner's
transaction behavior and take a verified backup before application. Account
deactivation and subsequent Auth deletion are separate operations; an Auth
deletion failure does not undo the anonymization or relationship cleanup.

The repository has not repaired or populated any migration ledger, and this
plan does not authorize applying migrations `013`-`018`, the timestamped
forward migrations, or deleting schema objects. Ledger reconstruction requires an operator-reviewed per-version
record; the current read-only audit alone is not sufficient evidence to mark
all twelve historical versions applied. No destructive action is authorized
without a verified recoverable backup, exact scope, and separate final
confirmation.
