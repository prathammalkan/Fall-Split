# Fall Split Release Readiness Checklist

## Current decision: RED — RELEASE BLOCKED

Local app verification is current, but release remains blocked on PostgreSQL/Supabase runtime reconciliation and production configuration evidence. Do not deploy or execute the SQL package based on this checklist alone.

## Required checks

- [x] Local tests pass.
- [x] Fresh suite result: 15 files passed; 159 passed, 6 skipped, 0 failed (165 total); skips are opt-in database tests.
- [x] Type-check passes.
- [x] Production build passes.
- [x] Clean production output contains no source maps, missing PWA icons, or private environment-secret markers.
- [x] `.env.local` is ignored and retained; the production-build check compared non-public local environment values against output without printing values, and found no matches.
- [x] Value-free credential check: the ignored local `SUPABASE_DB_PASSWORD` did not equal any of 26 historical URI-password candidates; exact non-public local values had 0 matches in the 24 production build files. `.env.local` still contains local database URL/password and service-role settings; do not stage or publish it.
- [x] Value-free reachable-history URI scan found credential-pattern matches in 13 commits; dedicated Gitleaks/TruffleHog scanners are unavailable. The old exposure remains in history and cleanup is still required before publishing.
- [x] Database password rotation is reported complete by the owner. No second rotation is requested absent evidence that the replacement credential was exposed; independently verify authorized direct-connection consumers were updated.
- [ ] Coordinate removal of the revoked credential from Git history and refresh collaborator clones before publication or push; the local working-tree cleanup does not erase historical copies.
- [x] Browser configuration uses `VITE_*` variables only for public values.
- [x] `.env.local` remains gitignored.
- [x] `.env.example` contains safe placeholders only.
- [x] Configure Content-Security-Policy and baseline browser security headers in `vercel.json`.
- [ ] Verify live Vercel response headers and the Git deployment integration after reauthentication.
- [x] Fresh-install all 20 repository migrations on disposable PostgreSQL 17.11 with a minimal Auth shim; no production ledger was changed.
- [ ] Reconcile remote migration history and prepare a reproducible baseline with an approved isolated Supabase environment before production DDL.
- [x] Execute `FINAL_SUPABASE_REPAIR.sql` on disposable PostgreSQL 17.11 against a representative migrations-001–012 baseline fixture with matching 36-policy fingerprints; postflight passed. Forced pre-COMMIT rollback and fail-closed rerun checks passed. This is not a full Supabase environment.
- [x] Apply the forward privilege migration as part of the 20-file PostgreSQL 17.11 chain and pass the repair grant/default-ACL postconditions.
- [ ] Verify inherited role behavior through Supabase Data API/PostgREST.
- [ ] Confirm friendship and group-invitation authorization with PostgreSQL-backed tests; the current local smoke does not cover these flows.
- [ ] Exercise friend request send/receive/accept/decline/cancel, duplicate concurrent requests, invite/QR redemption, and removal visibility through an isolated Supabase environment and real UI.
- [ ] Friend removal/unfriend is **NOT IMPLEMENTED**: current schema uses accepted request rows as the relationship and has no reviewed removal action. Define how historic expenses, balances, invitations, and re-adding should behave before implementing it.
- [x] Add local offline-sync regression tests and atomic database RPCs. Disposable PostgreSQL smoke now verifies regular/itemized RPC conservation, idempotency, spoof rejection, and invalid-itemized rollback; full Supabase integration remains pending.
- [x] Make local offline-queue idempotency lookup-and-insert atomic across concurrent browser contexts; a concurrent duplicate regression test passes.
- [x] Friendship screen now offers cancel for outgoing requests, reports relationship/balance load failures instead of presenting false empty/settled states, and ignores stale username-search responses; focused component tests pass.
- [x] Existing new-expense route now presents the existing form in a responsive native modal sheet with dialog labeling and Escape/backdrop dismissal; focused dialog tests pass.
- [ ] Verify pseudonymized profile retention, Auth-user deletion, stale JWT denial, and signup-trigger behavior on disposable staging.
- [ ] Live Supabase RLS and service-role configuration verified in a real environment.
- [ ] Isolated test environment not currently available: the Supabase account lists no Fall Split development branches; the pinned CLI runs with `npm exec supabase` (v2.121.0), but Docker is unavailable locally. The active Fall Split project is production and was not used for tests; no paid project/branch was created.
- [ ] External provider credentials validated in staging or production.
- [ ] Browser/device PWA installability validated on supported platforms.
- [ ] Verify the production Vercel domain, configured environment variables, response headers, and Git integration after the Vercel connector is reauthenticated.
- [x] `npm run format:check` passes after formatting the application source files.
- [ ] Perform browser and real-device PWA install/offline checks; local preview browser access was denied by browser policy, so these checks were not run.
- [ ] Validate friendship and financial user flows in a real isolated browser session; this run did not create test accounts or transactions.
- [ ] Real-browser test the new-expense sheet focus, mobile viewport/keyboard behavior, form submission, and existing settlement modal.
- [x] Add Privacy, Terms, and Support routes, linked from sign-in, registration, and Profile; content is explicitly marked draft.
- [ ] Replace legal placeholders with verified operator/entity, support and security contacts, effective date, data region/transfer details, and governing-law/jurisdiction details; obtain qualified legal approval.
- [ ] Review and resolve the missing `qrcode-generator` license file notice and choose/add the Fall Split project license or document approved proprietary distribution terms.

## Browser end-to-end outcomes

No isolated Supabase test project/accounts or accessible local browser session were available for this run. The browser policy previously denied access to the localhost preview. No test account, financial record, or invitation was created. These outcomes are **BLOCKED**, not passed:

| Scenario | Status | Evidence / next requirement |
|---|---|---|
| Signup, verification, sign-in, sign-out, recovery, session restore | BLOCKED | Requires isolated Supabase Auth and a test inbox. |
| Two-user friend requests: send, receive, accept, decline, cancel | BLOCKED | Requires two isolated test accounts and actual RLS/PostgREST. Cancel UI and load-error component cases have mocked unit coverage only. |
| Remove/unfriend and access after removal | NOT IMPLEMENTED | No supported UI/backend transition exists; behavior needs an explicit product/data-retention rule before implementation. |
| Friend invite link and QR: valid, invalid, duplicate, expired, reuse | BLOCKED | Requires isolated API/browser session and disposable invitation tokens. |
| Group create, invite, membership change, permission checks | BLOCKED | Requires isolated Supabase and multiple test users. |
| Expense equal, custom, percentage, weighted, itemized, multiple-payer flows | BLOCKED | Calculation/unit and PostgreSQL smoke coverage exists; full app/browser and Supabase API flows were not run. |
| Expense edit/delete and resulting balances | BLOCKED | Requires isolated API-backed transactions and end-to-end browser session. |
| Settlement initiation, confirmation, rejection, cancellation, duplicate/concurrent attempts | BLOCKED | Local SQL smoke does not cover settlement races; real Supabase/browser tests remain outstanding. |
| Dashboard, friend, group, expense, settlement pop-up behavior | BLOCKED | No browser interaction run. The existing new-expense route now displays its form in a responsive native modal sheet; the existing incoming-settlement modal remains unverified in-browser. |
| Empty/loading/error/success and recovery states | BLOCKED | Friendship load-error/cancel UI have targeted mocked component tests; other route states were not exercised in-browser. |
| Offline create, restart, reconnect, retry, duplicate prevention | BLOCKED | IndexedDB/offline queue unit tests pass; browser network toggling and restart behavior were not tested. |
| Sign-out/account switch and queued/private data isolation | BLOCKED | Unit/local checks exist; real session switching and browser storage behavior were not tested. |
| Invalid routes, direct links, refresh, back/navigation | BLOCKED | No browser route smoke run. |
| Keyboard, focus, forms, responsiveness, accessibility | BLOCKED | No browser/device accessibility or viewport testing run. |
| Console errors, failed requests, unexpected API responses | BLOCKED | No browser network/console inspection run. |
| PWA install, launch, service-worker update/cache behavior | BLOCKED | Build artifacts validated, but no actual browser installation or offline startup test. |

### Exact isolated-test setup

1. Install and start Docker Desktop. Do not point the local CLI at the linked production project.
2. From the repository run `npm run supabase:start`, then `npm run db:reset` to build a fresh local-only schema from the checked-in migrations. This reset is destructive only to the local Supabase stack. Confirm `supabase/config.toml` reports project ID `fall-split-local` and local API port `54321` before using test credentials.
3. Obtain local API values with `npm exec supabase -- status`; keep the output private. Put only the local API URL and local anon key in an ignored `.env.test.local`, then run the app with `npm run dev -- --mode test`. Use the local Studio and Inbucket from CLI output to create and verify disposable accounts; never reuse production users or tokens.
4. The six opt-in API tests also require local service-role key, two user IDs/JWTs, a private profile and group, an invitation token, retained expense and settlement fixtures, and exact disposable-project confirmation variables listed in `src/test/supabase.integration.test.ts`. Set `SUPABASE_DISPOSABLE_SECURITY_TESTS=1` only after creating those fixtures. Mark the target Auth user with `app_metadata.disposable_test_identity=true` and set `SUPABASE_SECURITY_AUTH_DELETE_CONFIRMATION=DELETE_AUTH_USER_<target-user-id>`; the test permanently deletes that local Auth user. Run `npm test -- --reporter=dot src/test/supabase.integration.test.ts`, then reset only the local stack before rebuilding fixtures.
5. For browser validation, install a supported browser runtime only in an authorized test environment, start the app using `.env.test.local`, and use the same disposable local accounts. This current desktop has no installed Playwright browser and browser policy has blocked localhost preview access; do not substitute production.

## Release recommendation

This repository is **RED — RELEASE BLOCKED** for production deployment. Fresh local typecheck, lint, formatting, unit tests, dependency audit, dependency-tree check, production build, and static PWA artifact checks pass; database runtime, provider settings, browser/device, and legal/license requirements remain open. The SQL repair is `READY FOR ISOLATED SUPABASE TESTING`; local PG 17 migration and representative-fixture tests passed. Complete full Supabase and production-schema reconciliation before production review. Then complete the legal, external configuration, license, and device checks above.

## Ordered release path

1. Provision/approve an isolated Supabase test target, independently verify its project identity, and use the local PostgreSQL 17.11 results as preliminary evidence only. Do not use production.
2. Test fresh installation from migrations `001`–`018` plus the timestamped forward migrations, then independently reconcile the existing-schema baseline with `supabase/manual/FINAL_SUPABASE_REPAIR.sql`. Do not infer an empty database from the production migration ledger.
3. Complete the RPC/RLS/grant/trigger/constraint, financial invariant, settlement concurrency, deletion/retention, idempotency, rollback, and rerun checks; update the SQL validation report with actual results.
4. The owner reports the database password has been rotated. Verify authorized direct-connection consumers use the replacement without displaying it. Coordinate removal of the revoked credential from Git history and collaborator clone refresh before publication. Confirm Supabase Auth, email, Google OAuth, account-deletion Edge Function deployment, Vercel auth/settings/headers, and Git integration.
5. Complete the legal contact/business placeholders and counsel review, select the project license, and resolve the dependency notice exception.
6. Complete browser and real-device PWA install/offline checks; only then submit the release for production review. Any production SQL execution or deployment must be separately authorized and follow that review.
