# Fall Split consolidated Supabase repair validation report

## Package status: READY FOR ISOLATED SUPABASE TESTING

The package has now executed successfully on a disposable PostgreSQL 17.11
cluster against a representative baseline fixture, with a PostgreSQL Auth shim.
This validates substantial PostgreSQL syntax and transaction behavior, but does
not validate Supabase Auth/PostgREST/SQL Editor behavior or establish that the
fixture is an exact clone of the current production catalog. Production use is
not approved. Overall release status remains RED / NOT READY.

## Scope and test setup

- Reviewed the consolidated SQL, runbook, migrations 001–018 and both timestamped
  forward migrations, plus migration reconciliation and release-blocker docs.
- Used a separate temporary PostgreSQL 17.11 cluster on localhost and dedicated
  databases `fall_split_validation`, `fall_split_repair_validation`, and
  rollback fixtures. The installed Windows PostgreSQL service was not modified;
  its password-protected connection was not used. No production credential or
  user data was used.
- The test cluster used a minimal `auth.users` table, roles `anon`,
  `authenticated`, and `service_role`, and a local `auth.uid()` shim. This is a
  test harness, not Supabase Auth or a Supabase local stack.
- Fresh installation applied all 20 repository migration files in sorted
  dependency order: migrations 001–018 followed by the two timestamped forward
  fixes. No migration ledger was created or edited.
- Existing-schema fixture applied migrations 001–012 only. Its 36 baseline
  RLS policies matched the repair package's audited fingerprints, and the
  package's other preconditions passed. The fixture contains no production
  rows and is representative from repository migrations/catalog findings; it
  is not a full schema dump or a clone of the managed Supabase environment.
- Prior read-only production audit found 17 existing application tables with
  RLS enabled, an empty migration ledger, and 36 policies. That evidence remains
  time-bounded; it does not describe any later production changes.

## Exact checks and results

| Check | Result |
|---|---|
| Fresh installation, migrations 001–018 plus both timestamped fixes | **PASS** — all 20 files executed successfully on PostgreSQL 17.11 with the documented Auth shim. 17 public base tables, 52 final policies, and 78 public routines were present after the chain. |
| Repair against the representative existing-schema fixture | **PASS after two SQL fixes** — all 36 audited baseline policy fingerprints and other preconditions passed; the full repair transaction committed and emitted its postflight success notice. Final policy count: 52. |
| Repair postconditions | **PASS** — required RPC signatures/results, RLS policies, grants, constraints, triggers, indexes, `SECURITY DEFINER` owners/search paths, default ACLs, and Auth/profile retention FK assertions completed in the script's postflight block. |
| Repair failure / transaction rollback | **PASS** — in a clone of the pre-repair fixture, an intentional exception injected immediately before `COMMIT` caused the client to fail. Follow-up catalog counts matched baseline: 36 policies, 0 atomic expense RPCs, 0 repair index, and the existing `profiles.deleted_at` column. |
| Repair rerun behavior | **PASS (fail closed)** — a second run against the repaired fixture was rejected before DDL because it found 52 policies instead of the expected 36. Counts of policies, RPC, and index remained 52 / 1 / 1. The script is intentionally one-shot, not idempotent. |
| Regular atomic expense RPC smoke | **PASS** — simulated active caller; 101-paise expense with 51/50 shares, payer/share conservation, idempotent retry returning the same ID, and creator-spoof rejection. |
| Itemized expense RPC smoke | **PASS** — 300-paise expense with two items and matching allocations; mismatched allocations were rejected and left no expense header. Test transaction rolled back. |
| Account retention smoke | **PASS** — a simulated Auth user was tombstoned and deleted after creating an expense; the anonymized profile, expense, payer, and shares remained. Test transaction rolled back. |
| Direct PostgreSQL RLS/privacy smoke | **PASS** — own profile access and public discoverability worked; private-profile RPC returned no nonfriend row; sensitive UPI column access was denied. Used the local `auth.uid()` shim, not JWT validation by Supabase Auth. |
| PostgreSQL 17 grammar/runtime compilation | **PASS for executed paths** — migrations and repair statements/functions/DO blocks compiled and executed on PostgreSQL 17.11. The earlier pglast 7.21 parse of 21 files remains supplementary evidence. |
| Supabase REST/PostgREST, real Supabase Auth, Edge Functions, and SQL Editor execution path | **NOT RUN** — the local harness does not provide those services. |
| Repository opt-in Supabase integration tests | **SKIPPED** — 6 tests require a disposable Supabase API/project and credentials; none were counted as passed. |
| Full settlement races, concurrent idempotency, all split modes and pairwise rounding, deletion retention, friendship/invitation/group authorization matrix | **NOT RUN** — these need broader database-backed fixtures and Supabase-specific testing. |
| Browser/device PWA tests | **NOT RUN** — prior local preview access was denied by browser policy; no device install/offline results are claimed. |
| Production SQL/data/config mutation | **NOT PERFORMED**. |

## Defects found and repaired

1. A financial postcondition selected `expense_id` from the wrong alias. The
   first server execution failed at that assertion. It now selects the
   `expense_id` carried by the allocation subquery.
2. A preflight existence guard cast an absent index name directly to `regclass`.
   PostgreSQL evaluated that cast despite the boolean guard, causing failure
   when the index was not present. It now compares against `to_regclass(...)`.

Both fixes were followed by a successful full repair execution and postflight.

## Transaction and rerun behavior

The repair contains its own explicit `BEGIN` and `COMMIT`; invoke the complete
file in one request without an additional client `--single-transaction` wrapper.
On this PostgreSQL client, an injected pre-commit exception rolled back the
schema changes. Supabase Dashboard SQL Editor timeout/cancellation semantics
remain untested. The successful run demonstrates local transaction behavior,
not that the production SQL Editor will accept the full request within its
limits. The repair's baseline guard intentionally rejects a second run.

## Secret-exposure finding (values withheld)

The owner reports the previously exposed database password has been rotated.
This external rotation has not been independently verified here; absent evidence
that the replacement credential was exposed, no second rotation is requested.
The historical URI and committed credential assignment remain in Git history;
coordinated history rewriting and collaborator clone refresh have not been
performed. Treat the old value as revoked based on the owner's report. A targeted history scan found database-URI
secret candidates in historical `BACKUP_RECOVERY.md` at lines 24 and 46 across
commits `7fa4184b93c3cff5b933da768e327c2e6ae45fa6`,
`6a8df7cd3c137c07b1445365ab77126012887d73`,
`b0e73868ab260b8b47900175a95eb3667ab904b2`,
`bf8ecdbff3b7fd37e2d5b31bfd0ed84d49599f80`,
`50dc43b83f720fc826b4274f4c3b9478ac26a7ec`,
`8fc545ad24cc8e8f2c3cfc62812003223b2159cb`,
`baa75b7250df5ac5d3ed49c9d1fab318522b4f88`,
`f8011d8ff75a0a364ec0b5b9ab8266fab7b4387`,
`44f28e883e91feebf7c53f371f93452d57c5b8ee`,
`90067379f6e15e3d37332ffa2b5a7df350b562ff`,
`760329f2e639c7e3033462c93e3f59642aab3489`, and
`1e0d19aa01375374281781933f52d8bcdd272b51`. A targeted credential-assignment
scan also flagged `scripts/check-auth.mjs`,
`scripts/check-instances-columns.mjs`, `scripts/configure-auth.mjs`, and
`scripts/run-migrations.mjs` in commit
`5065a2b13473ddd902c305e379b4c735196074da`. Values were not emitted.

The current-file path-based scan found no database URI/password, Supabase
secret-key-prefix, or private-key-pattern matches in repository files scanned;
`.env.local` was excluded from output and remains ignored. Only `.env.example` is
tracked among environment files. This targeted heuristic is not equivalent to a
full Gitleaks/TruffleHog scan: neither scanner is installed. A value-free
comparison of the ignored local `SUPABASE_DB_PASSWORD` with 26 historical URI
password candidates found no equality. The current `.env.local` also contains
direct-database URL and service-role-key settings; their values were not
printed, and exact checks found no match in the production build. `git log -G`
found URI-credential patterns in 13 reachable commits. Reachable history has
not been fully scanner-validated and still contains the revoked exposure. Do
not state that repository history is clean or that the replacement credential
was checked against all history.

Refs inspected: `master`, `origin`, and `origin/master` point to the same tip;
no tags were listed. No history rewrite, commit, push, or publication occurred.

## Remaining validation and release blockers

1. Test the final package in a disposable Supabase environment, including the
   actual Dashboard SQL Editor or supported runner; independently confirm exact
   project identity and runner transaction/timeout behavior.
2. Expand database tests to the complete financial, authorization, settlement
   concurrency, idempotency, deletion/retention, and failure matrix. Run the six
   existing opt-in integration tests only against confirmed disposable Supabase
   identities and API credentials.
3. Reconcile migrations 001–012 effect-by-effect with the retained live schema
   and establish a reviewed migration-ledger procedure; do not replay old
   migrations or manufacture ledger rows on production.
4. The owner reports the database password was rotated. Verify authorized
   direct-connection maintenance/backup consumers use the replacement without
   displaying it. Coordinate history cleanup and collaborator clone refresh
   only after separate authorization; do not rotate again absent evidence the
   replacement was exposed.
5. Verify Supabase Auth/email/Google OAuth, account-deletion Edge Function,
   Vercel production configuration, supported-browser/device PWA behavior,
   legal details and approvals, and the project/dependency license decisions.

No production changes were made. Overall release remains RED / NOT READY.




## Application/PWA checks refreshed after offline-queue, friendship, and expense-sheet fixes

The offline queue previously performed idempotency lookup and insertion in
separate IndexedDB transactions. These operations now share one readwrite
transaction, preventing concurrent contexts from inserting identical
user/key operations. A `Promise.all` regression test confirms both callers get
the same operation ID and only one record exists.

The Friends screen now exposes cancellation for outgoing requests, treats
relationship/profile/balance read errors as errors rather than empty or
settled balances, verifies a request update returned a row, and ignores stale
username-search responses. Two component regressions cover load failure and
outgoing-request cancellation. These are mocked UI tests; they do not prove the
production RLS policy or Supabase API behavior.

The existing new-expense route now wraps its two-step form in a responsive
native modal sheet. It uses the browser dialog API for modal semantics and
Escape handling, with backdrop dismissal and a DOM-test fallback. Focused tests
cover dialog naming and dismissal; mobile keyboard, focus restoration, and
browser behavior remain unverified.

| Check | Result |
|---|---|
| `npm test -- --reporter=dot` (2026-10-22 05:59 Asia/Kolkata) | **PASS** — 15 files; 159 passed, 6 skipped, 0 failed (165 total), 6.56 seconds. The six skips are opt-in Supabase API integration tests. |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | **PASS** — each command exited 0. |
| `npm audit --audit-level=high` / `npm ls --depth=0` | **PASS** — 0 vulnerabilities; direct dependency tree resolved without missing/invalid entries. |
| `npm run build` | **PASS** — 2,428 modules transformed; PWA manifest and service worker generated (33 precache entries, 903.50 KiB). |
| PWA artifact inspection | **PASS** — 9/9 icon files and dimensions valid, one registration script reference, 24 output files, no source maps. Browser/device behavior remains unverified. |
| Current-file/build secret checks | **PASS with stated scope** — no matches for database URI/password, `sb_secret_` prefix, or private-key patterns in scanned repo files; `.env.local` excluded from scanner output. Comparing non-public `.env.local` literals against all build outputs found 0 matches. No full history scanner is installed. |
| `git diff --check` | **PASS** — no whitespace errors. No files staged. |
