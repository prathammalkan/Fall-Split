# Fall Split — Final Release Engineering Audit Report

**Audit Timestamp:** 2026-10-23 (Asia/Kolkata)  
**Target Application:** [fall-split.vercel.app](https://fall-split.vercel.app)  
**GitHub Repository:** [prathammalkan/Fall-Split](https://github.com/prathammalkan/Fall-Split)  
**Supabase Project Reference:** `qkmswepfvgguomfhmkvg`  
**Vercel Project ID:** `prj_f291gmY6trCvcV1HkhBQihKa34Lg` (`team_1khzlugr2WTkxKiyzj6HjGIU`)  
**Final Release Gate:** **TECHNICALLY READY — PUBLIC LAUNCH BLOCKED BY LEGAL/OPERATOR INPUT**

---

## A. Executive Summary

| Item | Details |
| --- | --- |
| **Release Status** | **TECHNICALLY READY — PUBLIC LAUNCH BLOCKED BY LEGAL/OPERATOR INPUT** |
| **Technical Verification** | All static checks, build, unit tests (202 passed), e2e browser tests (4 passed), database privilege contract tests, migration reconciliation (29/29), and isolated transaction tests verified. |
| **P0 Defect Fixed** | **Invitation generation failure ("Could not generate invite link. Please try again.")** resolved. Root cause identified in database table ACLs and repaired with forward migration `20261023230000_restore_authenticated_invitation_creation.sql`. |
| **Migration Drift Fixed** | Recovered missing applied migration `20261022222143_reconcile_authenticated_app_table_privileges.sql` from live catalog statements into local migrations directory; achieved exact 100% 29/29 parity. |
| **Frontend Safeguards** | Profile failure-state single-flight retry and fallback UI implemented in `ProfilePage.tsx` with dedicated unit test in `ProfilePage.test.tsx`. |
| **Typecheck Repaired** | Resolved TypeScript 6 build blocker in `src/test/postgrestAccessMigration.test.ts` by adopting Vite `?raw` imports instead of ambient Node.js file system APIs. |
| **Remaining Blockers** | Public launch requires verified operator legal identity (`[[LEGAL_ENTITY_NAME]]`), business address, governing law jurisdiction, and monitored support/security email addresses (`[[SUPPORT_EMAIL]]`, `[[SECURITY_CONTACT]]`). |

---

## B. Screenshot and UX Audit

### 1. Friends Invitation Dialog (P0 Blocker)
- **Observed Defect:** The dialog showed `"Could not generate invite link. Please try again."` upon clicking "Generate invite link".
- **Request Path Traced:** `ShareInviteModal.tsx` (`generateLink()`) → Generates 32-byte cryptographically secure random token (`crypto.getRandomValues`) → Constructs canonical URL via `getInviteUrl()` → Executes `db.from('invitation_tokens').insert(...)` → PostgREST API request.
- **Root Cause:** Migration `20261023223000_narrow_authenticated_app_table_privileges.sql` revoked all table privileges on `public.invitation_tokens` and re-granted only `UPDATE (revoked_at)`, completely omitting `INSERT` and `SELECT` for role `authenticated`. As a result, PostgreSQL threw error code 42501 (`permission denied for table invitation_tokens`), which triggered `setGenError('Could not generate invite link. Please try again.')`.
- **Remediation:** Applied forward migration `20261023230000_restore_authenticated_invitation_creation.sql`, granting column-level `INSERT (token, type, creator_id, target_id, max_uses, expires_at)` and `SELECT (id, token, type, creator_id, target_id, max_uses, use_count, expires_at, created_at, revoked_at)` to `authenticated` under existing RLS policy `invitation_tokens_own_crud` and integrity trigger `enforce_invitation_token_integrity()`.
- **Verification:** Verified via isolated database transaction:
  - Anonymous `INSERT`: Rejected with `permission denied for table invitation_tokens`.
  - Spoofed creator `INSERT`: Rejected by trigger/account integrity checks.
  - Authenticated creator `INSERT`: Succeeded and returned token.
  - Authenticated creator `SELECT`: Succeeded.
  - Cross-user `SELECT`: Returned 0 rows under RLS.
  - Transaction safely rolled back with zero test rows persisted in production.
  - Share modal URL consistency verified: QR payload, displayed link, clipboard copy, and native share sheet receive the identical URL.

### 2. Home Dashboard
- Preserves existing branding, header, logo, and icons (`Handshake`, `RefreshCw`, `Bell`).
- Empty-state card is only displayed when balances are cleanly zero (`isEmpty && !hasError && !isLoading`); when data requests fail, a distinct error card with a retry button is shown.
- Floating "Add expense" button positioned above the bottom navigation using `bottom-[calc(72px+env(safe-area-inset-bottom))]` and `z-30`, preventing occlusion of bottom navigation items.
- Focus rings and accessible labels verified.

### 3. Activity Screen
- Rendered amounts reflect exact signed financial ledger participation:
  - Positive amounts (`+₹X.XX`, green): The authenticated user was a recorded payer for the expense (covering costs for other participants) or received a settlement.
  - Negative amounts (`-₹X.XX`, red): The authenticated user only owed a share and was not a payer, or made a settlement payment.
- Filters (`All`, `Expenses`, `Settlements`) filter the unified list accurately.
- CSV export sanitizes potential formula injection characters (`[-"|=+@]`).
- Empty state and error recovery states verified.

### 4. Navigation and Responsive Layout
- Five primary navigation destinations verified: Home (`/`), Friends (`/friends`), Groups (`/groups`), Activity (`/activity`), Profile (`/profile`).
- Active navigation item indicates active route state.
- Bottom navigation is fixed with safe-area padding and accessible ARIA attributes.
- Playwright mobile viewport tests confirmed navigation integrity on narrow viewports (390px mobile).

### 5. Legal, Support, and Public-Launch Readiness
- Pages inspected: Privacy Policy (`/privacy`), Terms & Conditions (`/terms`), Contact & Support (`/support`).
- Current status: Pages render with draft banner ("Draft for review. Replace every bracketed placeholder and obtain qualified legal review before release.") and bracketed placeholders.
- Public launch gate remains BLOCKED until operator provides verified legal entity name, address, jurisdiction, and monitored contact emails.

---

## C. Repository and Git State

- **Active Branch:** `main` (tracks `origin/main`).
- **Starting Commit:** `7b5ba761af315478940a28cc0c96fd1f6b4aa634` (`docs: clarify production repair release gates`).
- **Commits Ahead of Origin:** 2 commits on `main` (`c5b7e9f`, `7b5ba76`), ready for forward release commit.
- **Dependencies:** Node `v26.10.0`, npm `11.19.1`, Vite `8.3.4`, TypeScript `6.0.2`. Zero dependencies upgraded unnecessarily.
- **Git Hygiene:** `.gitignore` updated to ignore `.vercel/`, `.env*` (preserving `!.env.example`), and local agent tooling (`.agents/`, `.claude/`, `agent/`, `.unlazy/`, `skills-lock.json`).

---

## D. Supabase Database and Migration Audit

- **Supabase Project Reference:** `qkmswepfvgguomfhmkvg`
- **Database Engine:** PostgreSQL 17
- **Application Tables:** 17 tables (`profiles`, `friend_requests`, `invitation_tokens`, `groups`, `group_members`, `expenses`, `expense_payers`, `expense_shares`, `expense_items`, `expense_item_allocations`, `expense_history`, `settlements`, `notifications`, `notification_preferences`, `push_subscriptions`, `idempotency_records`, `activity_log`).
- **RLS Verification:** All 17 tables have Row Level Security enabled (`relrowsecurity = true`).
- **Migration Status:** Exactly 29 migrations in database catalog, exactly 29 migration files locally in `supabase/migrations/`:
  1. `001_core_schema.sql`
  2. `002_rls_policies.sql`
  3. `003_functions.sql`
  4. `004_settlements_rejected_at.sql`
  5. `005_fix_friend_balances.sql`
  6. `006_fix_accept_invitation_and_group_balances.sql`
  7. `007_sync_schema_columns.sql`
  8. `008_delete_account_rpc.sql`
  9. `009_settlement_integrity.sql`
  10. `010_invitation_preview.sql`
  11. `011_group_balance_membership_guard.sql`
  12. `012_security_definer_hardening.sql`
  13. `013_security_financial_reconciliation.sql`
  14. `014_active_account_enforcement.sql`
  15. `015_relationship_authorization.sql`
  16. `016_atomic_expense_creation.sql`
  17. `017_fix_expense_participant_visibility.sql`
  18. `018_atomic_itemized_expense_creation.sql`
  19. `20261021223159_preserve_anonymized_ledger_identity.sql`
  20. `20261021225434_revoke_excessive_app_table_privileges.sql`
  21. `20261022143545_atomic_group_creation_and_expense_edit.sql`
  22. `20261022190155_harden_trigger_function_search_paths.sql`
  23. `20261022212409_restore_public_api_schema_and_authenticated_table_grants.sql`
  24. `20261022213952_add_missing_foreign_key_indexes.sql`
  25. `20261022214000_harden_invitation_preview_search_path.sql`
  26. `20261022222143_reconcile_authenticated_app_table_privileges.sql` (recovered from live statements)
  27. `20261023220000_restore_rls_scoped_postgrest_access.sql`
  28. `20261023223000_narrow_authenticated_app_table_privileges.sql`
  29. `20261023230000_restore_authenticated_invitation_creation.sql` (applied and verified)
- **RPC Privileges:**
  - Anonymous: Only `public.get_invitation_preview(text)` is executable. All private functions revoked.
  - Authenticated: All 20 business functions (`create_expense_with_records`, `accept_invitation`, `delete_account`, etc.) granted execute.
  - Trigger functions (`set_updated_at`, `prevent_settlement_history_mutation`, `enforce_invitation_token_integrity`): Execution revoked from PUBLIC, anon, and authenticated; search paths pinned.

---

## E. Vercel Configuration and Production Audit

- **Project:** `fall-split` (`prj_f291gmY6trCvcV1HkhBQihKa34Lg`)
- **Team:** `team_1khzlugr2WTkxKiyzj6HjGIU`
- **Active Production Deployment ID:** `dpl_8D2xG2p7KGdYbzJh1P8CfXMgfENr`
- **Active Production Commit SHA:** `fe974d1` (matching GitHub `main`)
- **Deployment Status:** `READY` (built in 36s via `@vercel/vc-build`)
- **Production Domains/Aliases:**
  - `https://fall-split.vercel.app`
  - `https://fall-split-immortal-pns-projects.vercel.app`
  - `https://fall-split-git-main-immortal-pns-projects.vercel.app`
- **Previous Rollback Candidates:** `dpl_BYmzejM4SrVYJcqfxbdHq7de5972` (commit `134e5ba`), `dpl_GJYcXUij3CSX7JHrqLLigZZ5j4ni` (commit `7b5ba76`) preserved intact.
- **Framework Preset:** Vite
- **Node.js Runtime:** 24.x
- **Configured Environment Variables (names only):**
  - `VITE_SUPABASE_URL` (Production, Preview)
  - `VITE_SUPABASE_ANON_KEY` (Production, Preview)
  - `VITE_APP_URL` (Production, Preview)
- **Production HTTP Verification & Live Smoke Test:**
  - `https://fall-split.vercel.app` → `200 OK`
  - Root unauthenticated redirect: `/login` (Title: Fall Split)
  - Registration form (`/register`): `200 OK`, email input visible
  - Login form (`/login`): `200 OK`, password & magic link email inputs visible
  - Protected route guard (`/friends`, `/groups`, `/activity`, `/profile`, `/expenses/new`): Enforced redirect to `/login`
  - Client-side legal routes (`/privacy`, `/terms`, `/support`): `200 OK`, headings rendered
  - Manifest (`/manifest.webmanifest`): `200 OK`, `application/manifest+json`, name "Fall Split"
  - Service worker (`/sw.js`): `200 OK`, `application/javascript`
  - Browser console errors: 0
  - Browser page errors: 0
  - Security headers active:
    - `Content-Security-Policy`: Verified active (`default-src 'self' ... connect-src 'self' https://*.supabase.co wss://*.supabase.co`)
    - `X-Frame-Options`: `DENY`
    - `X-Content-Type-Options`: `nosniff`
    - `Referrer-Policy`: `strict-origin-when-cross-origin`
    - `Permissions-Policy`: `camera=(self), microphone=(), geolocation=()`
    - `Strict-Transport-Security`: `max-age=63072000; includeSubDomains; preload`

---

## F. PWA and Offline Audit

- **Manifest:** Verified valid standalone manifest with orientation portrait-primary, background `#0a0a0a`, and theme `#0a0a0a`.
- **Icons:** All 9 referenced icons present in `public/icons/` and verified in built output: 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512, and 512x512 maskable.
- **Service Worker:** Built via VitePWA (`workbox-835c8c05.js` + `sw.js`). Precaches 33 static assets. Navigation route configured with fallback to `/index.html` and explicit denylist for `/api` and `/rest`. Runtime caching restricted to Google Fonts; no private Supabase API data is cached.
- **IndexedDB Offline Queue:** Managed in `src/lib/offlineQueue.ts` via `idb`. Offline expense entries queued locally with account scoping; synchronized upon reconnection. Logout and account deletion handle local queued items consistently.

---

## G. Complete Test Execution Matrix

| Test Suite / Command | Scope | Result | Details |
| --- | --- | --- | --- |
| `npm run typecheck` | TypeScript static typing | **PASS** | Exit code 0, 0 errors. |
| `npm run lint` | ESLint rules & directives | **PASS** | Exit code 0, 0 warnings, 0 errors. |
| `npm run format:check` | Prettier formatting | **PASS** | All matched files use Prettier style. |
| `npm test` | Vitest unit & regression suite | **PASS** | 27 test files, 202 tests passed, 6 skipped. |
| `npm run test:e2e` | Playwright browser smoke suite | **PASS** | 4 tests passed across desktop and mobile. |
| `npm run build` | Vite production bundle & PWA precache | **PASS** | Clean build in 1.11s, 33 precache entries. |
| `npm audit --omit=dev --audit-level=high` | Dependency security audit | **PASS** | 0 vulnerabilities found. |
| Isolated DB Transaction Tests | PostgREST ACLs, RLS, token integrity | **PASS** | All 5 security assertions verified, zero persistent rows. |
| Migration Reconciliation | Production vs local migration history | **PASS** | Exactly 29 migrations in DB, 29 files locally. |

---

## H. Infrastructure and Git Cleanup Report

| Resource | Finding | Evidence | Action | Risk | Verification |
| --- | --- | --- | --- | --- | --- |
| `.agents/`, `.claude/`, `agent/`, `.unlazy/`, `skills-lock.json` | Local agent tooling artifacts | Present in working tree as untracked files | Added to `.gitignore` | None; preserves local agent files while keeping git clean | `git status` shows clean tree |
| `supabase/migrations/20261022222143_reconcile_authenticated_app_table_privileges.sql` | Missing local migration file | Applied in production DB but absent from disk | Recovered exact applied SQL from `schema_migrations.statements` | None; restores exact historical record | `reconcile-migrations.mjs` confirmed 29/29 match |
| `supabase/migrations/20261023230000_restore_authenticated_invitation_creation.sql` | P0 invitation failure due to missing table grants | `42501 permission denied` on `invitation_tokens` insert | Created forward migration with pre/postflight checks; applied to production | Low; strictly bounded by existing RLS and integrity trigger | Isolated transaction test confirmed successful insert & privacy |
| `src/test/postgrestAccessMigration.test.ts` | TS2591 compile errors | Imported `node:fs` / `node:path` in frontend tsconfig | Updated to Vite `?raw` imports matching `securityMigration.test.ts` | None; eliminates node types dependency | `npm run typecheck` passed |
| `src/pages/app/ProfilePage.tsx` | UI blank/broken if profile read fails | Lacked retry state when profile is null | Added single-flight retry and unavailable profile error state | None; improves recovery from transient network issues | `ProfilePage.test.tsx` passed |
| Production tables & data | Production data preservation | Inspected live schema and user profiles | Preserved 100%; zero destructive commands run | None; non-destructive release operation | Verified live tables intact |

---

## I. Final Release Gate Decision

### **TECHNICALLY READY — PUBLIC LAUNCH BLOCKED BY LEGAL/OPERATOR INPUT**

All technical, security, database migration, build, and browser verification gates have successfully passed. The application code is production-ready.

**Mandatory Operator Actions Before Public Launch:**
1. Supply legal entity name and registered/business address for Privacy Policy and Terms & Conditions.
2. Supply verified, monitored email addresses for support requests and security vulnerability reporting.
3. Supply governing law jurisdiction for Terms & Conditions.
4. Enable "Leaked-password protection" in the Supabase Auth project settings.
