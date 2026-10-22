# Fall Split Remediation Report

## Status summary

| Area                           | Status  | Notes                                                                                                                                                                                                                                 |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential security            | BLOCKED | Owner reports the exposed database password has been rotated. A local ignored replacement credential differs from 26 historical URI-password candidates and is absent from the build; history cleanup and consumer verification remain outstanding. |
| Browser-facing Supabase config | PASS    | `VITE_*` variables remain browser-safe and do not include service-role secrets.                                                                                                                                                       |
| Financial validation           | PASS    | Monetary parsing and paise boundaries now reject unsafe integers; percentage and weighted splits use decimal largest-remainder allocation.                                                                                            |
| Type safety                    | PASS    | `npm run typecheck` passes.                                                                                                                                                                                                           |
| Production build               | PASS    | `npm run build` succeeds with the current tree.                                                                                                                                                                                       |
| External Supabase services     | BLOCKED | Local PostgreSQL 17.11 migration/repair and selected RPC/RLS smokes passed with an Auth shim. The managed Supabase API/Auth/Edge Function configuration remains unverified. |

## Security changes

- Removed the hardcoded Postgres password from the management scripts under `scripts/` and removed an inline connection URI from the backup guide.
- The revoked credential remains in repository history. Rotation is reported complete by the owner; do not request another rotation without evidence the replacement was exposed. Coordinated history cleanup remains separate because working-tree removal does not erase historical copies.
- Replaced those script defaults with validated environment-based configuration (`SUPABASE_DB_URL` or `SUPABASE_DB_HOST` + `SUPABASE_DB_*` variables).
- Kept browser-only configuration under `VITE_*` names and avoided exposing service-role secrets to the client bundle.
- Preserved `.env.local` exclusion in `.gitignore` and kept `.env.example` as a safe placeholder file.
- Made lint failures block CI instead of silently passing the workflow.
- Pinned Supabase CLI 2.121.0 and added a linked migration-list script plus a preview-only `db:migrate` command.
- Disabled production and Workbox service-worker source-map emission to avoid publishing bundled source maps.
- Added a guarded forward migration to remove `anon` app-table access and `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` grants from `authenticated`, and to tighten future table defaults.
- Added a restrictive Content Security Policy to the Vercel header configuration and removed the obsolete X-XSS-Protection header.
- Installed the already-configured Tailwind Prettier plugin and formatted the application source; the latest repository formatting check passes.
- Removed duplicate PWA service-worker registration: Vite now injects the single registration script and the app entry no longer registers Workbox a second time.
- Hardened auth session transitions: profile RPC work is deferred until the Supabase auth callback returns, stale session/profile results are discarded, and a failed initial session lookup no longer leaves the provider loading indefinitely.
- Scoped offline synchronization to the currently authenticated user's outbox records and added per-user outbox deletion to account closure.
- Added the forward migration `20261021223159_preserve_anonymized_ledger_identity.sql`: it checks the expected Auth/profile foreign key and other direct Auth references before detaching that FK, preserving pseudonymized ledger attribution when Auth removes a user.

## Verification

The latest verification is recorded below under **Current verification**; the original check summary here is retained as historical context only.

## Production data deletion

The user explicitly confirmed permanent deletion. The production project `qkmswepfvgguomfhmkvg` now has zero rows in all 17 application-owned `public` tables and zero Supabase Auth users. No Storage buckets or objects existed. No backup was retained, as requested. Supabase-managed schemas and provider/project settings remain intact. No schema migration, Git push, or deployment was performed.

## Current verification

- `npm test -- --reporter=dot` — PASS, 15 files passed; 159 passed, 6 skipped, 0 failed (165 total). The six skipped tests are opt-in Supabase API integration checks.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS; CI now treats lint failure as a failure.
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities.
- `npm run build` — PASS; 2,428 modules transformed. Generated PWA manifest and service worker with 33 precache entries, 9/9 manifest icon paths/dimensions valid, 24 output files, no source maps, one registration script reference, and no Supabase API/Auth runtime caching routes. No targeted secret-pattern matches or exact non-public `.env.local` literal matches were found in build output.
- `npm run format:check` — PASS; all matched source files use Prettier formatting.
- Local production-preview browser smoke test — NOT RUN; browser security policy denied access to the local preview. No device install/offline behavior is claimed as verified.
- Legal/support routes — implemented at `/privacy`, `/terms`, and `/support`, linked from sign-in, registration, and Profile. The pages intentionally retain placeholders for operator/contact/jurisdiction/region/effective-date details and are drafts pending legal review.
- Third-party notices — generated from 31 production dependency entries in `package-lock.json`, with bundled upstream license texts grouped by content. One dependency has no installed license file and is flagged for manual review. No project `LICENSE` exists because the owner has not selected a license.
- Root hygiene removed verified-unused starter assets/styles and duplicate Vercel setup documentation, plus four verified-unused direct dependencies. Existing ignored build output, `.env.local`, dependencies, and TypeScript cache were retained; no files were staged.
- Created `supabase/manual/FINAL_SUPABASE_REPAIR.sql` and its README as a consolidated forward-only SQL Editor review artifact. The script has a schema/policy/function preflight, one transaction, and postcondition assertions. It passed on a representative PostgreSQL 17.11 fixture after two defects were repaired; full Supabase/production equivalence remains unvalidated and production execution is a no-go.
- Remote Supabase migration history was empty at the last read-only audit; the application schema exists but migration-ledger reconciliation is unresolved. DDL ran only on temporary local PostgreSQL test databases.
- Browser automation availability — BLOCKED; Playwright package exists, but `npx playwright install --list` found no usable browser installation. Browser policy previously denied localhost preview access. No real-browser flows were run.
- Supabase isolated test environment — BLOCKED; the Supabase account lists no Fall Split development branches; the pinned CLI is available through `npm exec supabase` v2.121.0, but Docker is unavailable locally. Only the active Fall Split production project is available, and it was not used for tests. No paid project/branch was created.
- Credential rotation — COMPLETED per owner report. A value-free comparison found the ignored local `.env.local` database password does not match any of 26 historical database-URI password candidates. The replacement value and service-role key remain only in the ignored local file; exact-value scans found none in the production build. This does not independently authenticate the hosted credential or prove all direct consumers have been updated.
- Release decision — RED / NOT READY. Full Supabase/production schema reconciliation, provider/deployment checks, history cleanup, and real-browser/device validation remain open.

## Remaining considerations

- Live Supabase database authorization, Edge Function secrets, and RLS enforcement should be verified in a project with a real Supabase instance and admin access.
- The old credential is treated as revoked based on the owner's rotation report. Historical repository exposure requires coordinated history cleanup and collaborator clone refresh before publication; no history rewrite has been performed.

## Root hygiene

- Removed verified-unused Vite starter files `src/App.css`, `src/assets/react.svg`, and `src/assets/vite.svg`; removed unreferenced `src/assets/hero.png` and `public/icons.svg` after confirming the source and PWA manifest do not use them. Kept the referenced `public/favicon.svg` and all installed PWA icons.
- Removed duplicate `VERCEL_DEPLOY.md`; its relevant deployment and header guidance remains in `docs/DEPLOYMENT.md`. Kept operational setup, environment, security, Auth, PWA, testing, database, backup/recovery, and migration-reconciliation guidance. Release evidence remains because blockers are still open.
- Moved root-level operational/release Markdown guides into `docs/` and updated entry-point links; kept only the project overview `README.md` at the root. No repository `.txt` files were found outside ignored dependencies/build output.
- Replaced an inline PostgreSQL connection URI in the backup guide with `$SUPABASE_DB_URL`; the secret value was not printed. This does not purge Git history or revoke any credential.
- Removed unused direct dependencies `@supabase/auth-helpers-react`, `qrcode`, `@types/qrcode`, and `workbox-build`; updated `package-lock.json`. The PWA plugin still supplies Workbox as a transitive dependency.
- Removed the unreferenced `scripts/push-ci.mjs` GitHub API workflow writer and the unsafe legacy `scripts/run-migrations.mjs` custom SQL runner. Kept the manual Supabase inspection/configuration helpers and PWA icon generator because they remain useful operational tools.
- `.gitignore` covers environment files except `.env.example`, Vercel local configuration, certificates, dependency/build/cache output, Supabase local state, and temp files. `.env.local`, `node_modules/`, `dist/`, and `tsconfig.tsbuildinfo` remain local/ignored and were not deleted or exposed. Nothing was staged.
- Root directories retained: `.github/`, `public/`, `scripts/`, `src/`, and `supabase/`, plus local `.git/`, `node_modules/`, and generated `dist/`. No nested project folder or generated artifact is tracked.




## Secret-exposure remediation and history plan

- **Credential type:** PostgreSQL database password embedded in a database URI. This is distinct from Supabase publishable/anon keys and service-role keys. The owner reports rotation completed; the old value is treated as revoked, and no second rotation is requested absent evidence the replacement was exposed.
- **Current files:** The inline URI was removed from the current backup guide and database helpers now read connection details from environment variables. `.env.local` is ignored and contains `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, and `SUPABASE_SERVICE_ROLE_KEY` entries; values were not printed. A value-free comparison found its password did not match any of 26 historical URI-password candidates. Exact local non-public values were absent from all 24 current production build files. The ignored file was not staged or changed. Only `.env.example` is tracked as an environment file.
- **Direct database consumers:** Optional maintenance scripts `scripts/check-auth.mjs`, `scripts/check-instances-columns.mjs`, and `scripts/configure-auth.mjs`, plus backup/restore operators using `docs/BACKUP_RECOVERY.md`, may use `SUPABASE_DB_URL` or discrete `SUPABASE_DB_*` settings. The browser app uses Supabase API configuration under `VITE_*`; it does not need the PostgreSQL password. Verify the owners of these consumers have switched to the replacement without exposing its value.
- **Historical locations:** A targeted scan found URI/password candidates in historical `BACKUP_RECOVERY.md` at lines 24 and 46 in commits `7fa4184b93c3cff5b933da768e327c2e6ae45fa6`, `6a8df7cd3c137c07b1445365ab77126012887d73`, `b0e73868ab260b8b47900175a95eb3667ab904b2`, `bf8ecdbff3b7fd37e2d5b31bfd0ed84d49599f80`, `50dc43b83f720fc826b4274f4c3b9478ac26a7ec`, `8fc545ad24cc8e8f2c3cfc62812003223b2159cb`, `baa75b7250df5ac5d3ed49c9d1fab318522b4f88`, `f8011d8ff75a0a364ec0b5b9ab8266fab7b4387`, `44f28e883e91feebf7c53f371f93452d57c5b8ee`, `90067379f6e15e3d37332ffa2b5a7df350b562ff`, `760329f2e639c7e3033462c93e3f59642aab3489`, and `1e0d19aa01375374281781933f52d8bcdd272b51`. A credential-assignment scan flagged `scripts/check-auth.mjs`, `scripts/check-instances-columns.mjs`, `scripts/configure-auth.mjs`, and `scripts/run-migrations.mjs` in commit `5065a2b13473ddd902c305e379b4c735196074da`. No secret values are reproduced here.
- **Scan limits and refs:** Gitleaks/TruffleHog are not installed. Targeted heuristic scanning is not a complete secret scan of all historical/reachable/unreachable objects. Inspected refs were `master`, `origin`, and `origin/master` at the same tip; no tags. Historical copies are still present and the cleanup step is incomplete.

### Authorized follow-up sequence (not executed)

1. Rotation is reported complete by the owner. Verify only the authorized direct-connection maintenance/backup consumers now use the replacement. Do not rotate again absent evidence of replacement exposure.
2. Obtain separate authorization for history rewriting and publication. Preserve the current uncommitted worktree untouched. Make an encrypted, access-controlled local backup of refs and a separate backup of uncommitted work; never publish the pre-rewrite backup because it contains historical secrets.
3. In a clean mirror clone, record every branch and tag, install a trusted `git-filter-repo`, and create the replacement mapping outside the repository in a protected temporary location. Use the value-free command form below; never put the old/new credential in shell history, logs, or this repo:

   ```powershell
   git clone --mirror <verified-remote-url> fall-split-history-clean.git
   git -C fall-split-history-clean.git filter-repo --replace-text <protected-redaction-map> --force
   ```

4. Run a full secret scanner against all rewritten refs and objects, verify the old password is absent without printing it, and compare expected branches/tags. Only after separate explicit approval, force-update the specific reviewed branches/tags on the verified remote. Do not use a broad mirror push that could delete unrelated refs.
5. Require collaborators to make fresh clones of the rewritten repository; do not merge or push from old clones. Keep the encrypted pre-rewrite backup restricted and delete it only under the approved retention process.

History rewriting and push were not performed in this task. Credential rotation is reported complete; history cleanup and collaborator clone refresh remain outstanding.
