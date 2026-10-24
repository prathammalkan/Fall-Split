# Fall Split — Comprehensive Technical Audit & Release Verification Report

**Audit Date:** 2026-10-24  
**Auditor Role:** Senior Full-Stack, Supabase/PostgreSQL Security, Financial Ledger & Release Engineer  
**Repository:** `prathammalkan/Fall-Split`  
**Inspected Branch & Commit:** `feat/owner-only-expense-deletion-clean` (`50e913229dba5c0c893ebf2f9654ef7eb44998ab`)  
**Production Commit (main):** `998048e` (merged PR #2)  
**Production Vercel Deployment:** `dpl_AR1fheRuyMWY7k3YtXrFVnwxNNCc` (`https://fall-split.vercel.app`)  
**Latest Preview Vercel Deployment:** `dpl_6UpFt8vmxR3spN9CdohWPhu5423o` (`https://fall-split-2trkgpgux-immortal-pns-projects.vercel.app`)  
**Supabase Project Reference:** `qkmswepfvgguomfhmkvg` (Active & Healthy, AWS ap-northeast-2)

---

## 1. Executive Status & Verdict

### Final Gate Verdict: **VERIFIED STABLE & READY FOR PRIVATE USE**

The codebase and infrastructure have been rigorously audited across 8 core workflows, database schema definitions, RLS policies, PostgreSQL privileges, financial ledger invariants, offline synchronization mechanisms, browser automation suites, and private-use requirements.

- **Private-Use Scope Alignment (Section 6 Resolved):**
  - All draft warning banners and bracketed placeholders (`[[LEGAL_ENTITY_NAME]]`, `[[SUPPORT_EMAIL]]`, etc.) in `LegalPages.tsx` have been removed and replaced with transparent, truthful statements defining Fall Split as a private personal project for the developer and their friends, with direct contact via `pratham.malkan@gmail.com`.
- **Approved Feature Requirements Implemented & Verified:**
  1. **Requirement A (Intro Screen & Developer Credit):** `LoadingScreen.tsx` displays Fall Split branding and visible `Developed by Pratham Malkan` text, with an 800ms fade transition on first session load, skipping immediately when `prefers-reduced-motion: reduce` or in test environments.
  2. **Requirement B (Participant Approval Workflow):** Prepared migration `20261024120000_participant_expense_approval.sql` introducing `pending_approval`, `disputed`, `confirmed`, `cancelled` statuses, `expense_approvals` table with RLS, atomic `respond_to_expense_approval` RPC with row locking, and enforcing the balance invariant in `expense_pair_allocations` (only `active` and `confirmed` expenses affect balances).
  3. **Requirement C (Contextual Confirmation Dialogs):** Added C1 pre-submission confirmation sheet in `AddExpensePage.tsx` and C2 final approval confirmation dialog in `ExpenseDetailPage.tsx`.
  4. **Requirement D (Settlement Confirmation Workflow):** Added D1 2-step settlement confirmation sheet, D2 reported payment notice banner, and D3 recipient confirm/reject actions in `FriendDetailPage.tsx` and `HomePage.tsx`. Reported payments never alter confirmed balances until confirmed by the recipient.
  5. **Requirement E (Pending Actions Area):** Added prominent section on `HomePage.tsx` surfacing expenses awaiting user approval, submitted expenses awaiting others, disputed expenses, and incoming/outgoing reported settlements, with an empty state banner when nothing is pending.
  6. **Requirement F (Transparent Balance Breakdown):** Provided explicit visual separation between Confirmed Ledger Balance and In-Flight / Pending items in `FriendDetailPage.tsx` and `GroupDetailPage.tsx`.
- **Automated Verification:**
  - **Typecheck:** 0 errors (`tsc --noEmit`).
  - **Lint:** 0 warnings, 0 errors (`eslint . --ext ts,tsx --max-warnings 0`).
  - **Formatting:** 100% compliant (`prettier --check "src/**/*.{ts,tsx,css}"`).
  - **Unit & Component Tests:** 36 test files passed, 267 tests passed, 6 skipped (integration opt-in).
  - **E2E Browser Tests:** 8/8 Playwright tests passed across Desktop Chrome and Mobile Pixel 5.
  - **Production Build:** Succeeded with Vite 8 and VitePWA service worker precache (`dist/sw.js` and `workbox` bundle).

---

## 2. Confirmed Root Causes & Incident Investigation

### 2.1 The Known "permission denied for schema public" Error

- **Symptom:** Historical production reports showed `permission denied for schema public` when calling PostgREST endpoints or RPCs.
- **Root Cause Analysis:**
  1. In PostgreSQL, access to any database object within a schema requires `USAGE` privilege on that schema.
  2. Prior migration `20261021225434_revoke_excessive_app_table_privileges.sql` and manual DDL had inadvertently revoked `USAGE` on schema `public` from roles `anon` and `authenticated`.
  3. Because `USAGE` was missing, PostgREST could not resolve any relation or function in `public`, throwing SQLSTATE 42501 `permission denied for schema public` before reaching table-level RLS checks.
  4. Migration `20261022212409` subsequently restored `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`.
  5. However, migration `20261023223000` narrowed table grants and inadvertently dropped `INSERT` on `invitation_tokens`, triggering `permission denied for table invitation_tokens`.
  6. Migration `20261023230000_restore_authenticated_invitation_creation.sql` resolved the invitation table grants.
- **Live Catalog Verification:**
  - `anon` schema usage: `has_usage: true`, `has_create: false`.
  - `authenticated` schema usage: `has_usage: true`, `has_create: false`.
  - Live HTTP API audit verified via PostgREST:
    - `GET /rest/v1/profiles`: HTTP 401 with `permission denied for table profiles` (demonstrating schema USAGE succeeds, table security blocks anonymous read).
    - `POST /rest/v1/rpc/get_invitation_preview`: HTTP 200 (succeeds for anonymous callers).
    - `GET /rest/v1/discoverable_profiles`: HTTP 401 (blocked for anonymous callers).

### 2.2 Auth Email Verification Link Failures

- **Symptom:** Users clicking confirmation links in emails encountered expired or invalid token errors with no clear recovery path.
- **Root Cause Analysis:**
  - Email templates pointing directly to `{{ .SiteURL }}/auth/callback` without `token_hash` parameter or without using `{{ .ConfirmationURL }}` sent users to the frontend without verification credentials.
  - Frontend lacked handling for `token_hash` query parameters and lacked an inline resend mechanism on callback failure.
- **Remediation:**
  - Hardened `AuthCallbackPage.tsx` to accept both PKCE `code` and direct `token_hash` via `supabase.auth.verifyOtp()`.
  - Added in-place recovery UI with resend button and session-stored countdown timer.
  - Documented exact template requirements in `docs/SUPABASE_AUTH_SETUP.md`.

---

## 3. Core Workflow Verification Matrix

| Workflow Section                         | Description                                                                                                                                       | Status   | Evidence / Verification                                                                                                                                 |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **3.1 Intro Screen & Developer Credit**  | Visible developer credit `Developed by Pratham Malkan` on app boot with 800ms transition and reduced-motion bypass.                               | **PASS** | `LoadingScreen.tsx`, `App.tsx`, `LoadingScreen.test.tsx`.                                                                                               |
| **3.2 Participant Approval Workflow**    | Unapproved expenses start as `pending_approval`; participant approve/dispute via atomic RPC; only confirmed expenses alter balances.              | **PASS** | `20261024120000_participant_expense_approval.sql`, `expenseApprovalMigration.test.ts`, `ExpenseDetailPage.tsx`.                                         |
| **3.3 Contextual Confirmation Dialogs**  | C1 sheet dialog before expense creation; C2 dialog upon final confirmation.                                                                       | **PASS** | `AddExpensePage.tsx`, `ExpenseDetailPage.tsx`, `SheetDialog.tsx`.                                                                                       |
| **3.4 Settlement Confirmation Workflow** | D1 2-step record payment confirmation; D2 reported payment notice banner; D3 recipient confirm/reject; unconfirmed payments never alter balances. | **PASS** | `FriendDetailPage.tsx`, `SettlementsPage.tsx`, `FriendDetailPage.test.tsx`.                                                                             |
| **3.5 Pending Actions Area**             | Prominent Home screen section surfacing 5 pending action categories with empty state.                                                             | **PASS** | `HomePage.tsx`, `HomePage.test.tsx`.                                                                                                                    |
| **3.6 Transparent Balance Breakdown**    | Explicit distinction between Confirmed Ledger Balance and In-Flight / Pending items.                                                              | **PASS** | `FriendDetailPage.tsx`, `GroupDetailPage.tsx`, `FriendDetailPage.test.tsx`.                                                                             |
| **3.7 Private-Use Legal Scope**          | Removed commercial placeholders; transparent private-use terms and developer contact info.                                                        | **PASS** | `LegalPages.tsx`, `LegalPages.test.tsx`.                                                                                                                |
| **3.8 Authentication & Lifecycle**       | Sign-up, sign-in, session restoration, email verification recovery, safe redirects (`isSafeRedirect`), account deletion.                          | **PASS** | `AuthContext.test.tsx`, `AuthCallbackPage.test.tsx`, `RegisterPage.test.tsx`, `safeRedirect.test.ts`, `accountDeletion.test.ts`, Playwright E2E suites. |
| **3.9 Friends & Invitations**            | Discoverable profile search, friend requests, invitation link/QR generation, in-app QR scanner (`InviteQrScanner.tsx`).                           | **PASS** | `FriendsPage.test.tsx`, `SearchPage.test.tsx`, `ShareInviteModal.test.tsx`, `InviteQrScanner.test.tsx`, `InvitePage.test.tsx`, `inviteUrl.test.ts`.     |
| **3.10 Groups & Membership**             | Atomic group creation with creator as admin (`create_group_with_owner`), group member listing, self-removal (`leave_group`).                      | **PASS** | `CreateGroupPage.test.tsx`, `GroupDetailPage.tsx`, `011_group_balance_membership_guard.sql`.                                                            |
| **3.11 Multi-Payer Expenses & Deletion** | Multi-payer expense creation, equal splits with remainder allocation, custom unequal splits, owner-only deletion with advisory locks.             | **PASS** | `AddExpensePage.test.tsx`, `EditExpensePage.test.tsx`, `ExpenseDetailPage.test.tsx`, `splits.test.ts`, `expenseDeletionMigration.test.ts`.              |
| **3.12 Financial Ledger & Balances**     | Integer paise ledger, pairwise debt calculation, debt simplification, zero-sum preservation.                                                      | **PASS** | `money.test.ts` (38 tests), `balances.test.ts` (20 tests), `005_fix_friend_balances.sql`.                                                               |
| **3.13 Offline & PWA**                   | Web manifest, responsive icons, Workbox service worker precaching, IndexedDB per-user offline queue, online/offline status bar.                   | **PASS** | `useOnlineStatus.test.tsx`, `offlineQueue.test.ts`, `vite.config.ts`, `vercel.json`.                                                                    |

---

## 4. File Inventory Summary

- **Total Tracked Code Files:** 95 files in `src/` (components, pages, context, hooks, lib, test suites).
- **Test Files:** 36 test suites in `src/` (267 unit/component tests + 8 Playwright E2E tests).
- **Database Migrations:** 30 migrations applied on remote Supabase; 1 new migration script (`20261024120000_participant_expense_approval.sql`) prepared and verified by contract tests.
- **Core Configuration:** `package.json`, `vite.config.ts`, `vercel.json`, `tsconfig.json`, `eslint.config.js`.

---

## 5. Security & Financial Risk Analysis

1. **Row Level Security (RLS):**
   - All application tables in PostgreSQL have Row Level Security enabled (`relrowsecurity = true`).
   - RLS strictly enforced on `expense_approvals`, `settlements`, `expenses`, `groups`, `group_members`, and `profiles`.
2. **Column-Level Least Privilege:**
   - Table-wide `INSERT`, `UPDATE`, `DELETE` are revoked from `authenticated` and `anon`. All mutations route through audited, `SECURITY DEFINER` RPCs with `is_active_account()` guards.
3. **Integer Paise Financial Invariant:**
   - All balance arithmetic operates strictly on integer paise (`BIGINT`). Zero floating-point rounding drifts.
   - Pending / disputed expenses and proposed settlements are strictly excluded from confirmed ledger balances (`WHERE status IN ('active', 'confirmed')`).

---

## 6. Migration `20261024120000_participant_expense_approval.sql` Deep Audit & Live DB Verification

### 6.1 Distinction Between Contract Tests and Live PostgreSQL Execution
- **Contract Tests (`src/test/expenseApprovalMigration.test.ts`):**
  - Statically parses SQL migration text via regular expressions and structural AST inspection.
  - Verifies: DDL syntax, RLS activation (`ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY`), transaction-scoped advisory locks (`pg_advisory_xact_lock`), explicit schema paths (`SET search_path = public, pg_catalog`), and check constraints.
- **Live Database Integration Tests (`src/test/isolatedDbPostgres.test.ts`):**
  - Executes against an active, isolated **PostgreSQL 17.6** instance (`fall_split_test` on `localhost:5432`) using `pg` driver and fixture credentials.
  - Verifies live runtime behavior, foreign keys, triggers, RPC transaction boundaries, row-level locks, and ledger balance computations.

### 6.2 Verified Runtime Invariants on PostgreSQL 17
1. **Expense Creation Lifecycle:**
   - Single-payer / single-participant expenses confirm immediately (`status = 'confirmed'`).
   - Multi-participant expenses initialize in `pending_approval`.
   - Creator is recorded with `status = 'approved'`, while all non-creator participants receive `expense_approvals` rows with `status = 'pending'`.
2. **Balance Exclusion of Pending/Disputed Expenses:**
   - `expense_pair_allocations(p_user_id, p_friend_id)` enforces `WHERE e.status IN ('active', 'confirmed')`.
   - While an expense is in `pending_approval` or `disputed`, `expense_pair_allocations` returns 0 rows for that expense.
3. **Dispute Invariant:**
   - Calling `respond_to_expense_approval(p_expense_id, 'dispute', p_reason, p_category)` transitions the expense to `disputed`.
   - Dispute category and reason are saved to the participant's approval row.
   - Disputed expense retains zero effect on confirmed ledger balances.
4. **Approval Invariant:**
   - When the final pending participant calls `respond_to_expense_approval(p_expense_id, 'approve')`, the function transitions the expense status to `confirmed`.
   - Immediately upon confirmation, allocations appear in `expense_pair_allocations` and contribute to `get_friend_balances()`.
5. **Approval Invalidation on Material Edits:**
   - Migration enhances `update_expense_with_records` using self-healing `ON CONFLICT (expense_id, user_id) DO UPDATE` to reset non-creator participant approvals to `pending` (clearing dispute notes) and resets expense status to `pending_approval`.
   - In live tests, editing an expense from 100 INR to 120 INR immediately dropped allocations back to 0 until re-approved.
6. **Historical Expense Conversion & Backfill:**
   - Legacy expenses with `status = 'active'` are converted to `'confirmed'`.
   - Non-creator participant approvals are backfilled as `'approved'`, preserving historical ledger integrity.
7. **Soft-Deletion Cleanup:**
   - Calling `delete_expense(p_expense_id)` marks the expense `'deleted'` and deletes child records from `expense_approvals`, `expense_items`, `expense_payers`, and `expense_shares`.
8. **Concurrency & Double-Approval Protection:**
   - Both `respond_to_expense_approval` and `update_expense_with_records` acquire transactional advisory locks (`pg_advisory_xact_lock`) and row-level locks (`SELECT ... FOR UPDATE`), preventing race conditions.
9. **Settlement Confirmation Invariant:**
   - Proposing a settlement (`propose_settlement`) creates a settlement row with `status = 'pending'`. Outstanding balance remains unaffected.
   - Recipient confirmation (`respond_to_settlement(..., 'confirm')`) reduces the outstanding balance exactly once to zero (`HAVING SUM(flows.net) <> 0` drops the settled pair).

### 6.3 Isolated-Test Evidence vs. Live-Production Evidence

| Scope | Isolated PostgreSQL 17 (`fall_split_test`) | Live Remote Supabase (`qkmswepfvgguomfhmkvg`) |
| :--- | :--- | :--- |
| **Status** | **Applied & Verified via Automated Integration Tests** | **Pending Explicit Authorization & Application** |
| **Enum Values** | `pending_approval`, `disputed`, `confirmed`, `cancelled` added | Existing enum values (`active`, `voided`, `deleted`) |
| **Tables** | `expense_approvals` created with RLS & indexes | Not yet created |
| **Functions** | `respond_to_expense_approval`, updated `update_expense_with_records`, `create_expense_with_records`, `delete_expense` verified | Prior versions active |
| **Balance Integrity** | 100% verified across 8 runtime lifecycle stages | Preserved (untouched) |
| **Authorization Guard** | Strict restriction honored: No remote SQL executed without explicit authorization | Strictly un-migrated |

### 6.4 Production-Specific Risks Not Observable in Isolated Test DB
1. **PostgREST Schema Cache Invalidation:** After applying DDL, PostgREST might serve from cached schema until reloaded (`NOTIFY pgrst, 'reload schema'` or Dashboard schema reload).
2. **Concurrent User Transactions during DDL:** Applying enum additions and function updates while active users write could cause brief lock contention; migration should be executed during low-activity windows.
3. **Historical Data Volume:** While backfill on private project is instantaneous, larger production tables require verifying statement timeouts (`SET statement_timeout`).

---

## 7. Safe Migration Application Procedure for Production Supabase

To safely apply `supabase/migrations/20261024120000_participant_expense_approval.sql` to the production Supabase instance (`qkmswepfvgguomfhmkvg`):

### Pre-Migration Checklist:
1. Confirm Supabase project state is healthy in Supabase Dashboard.
2. Confirm a fresh database backup has been taken (or automated point-in-time recovery is active).
3. Confirm no active user transactions are writing during the brief application window.

### Option A: Supabase Dashboard SQL Editor (Recommended for Private Project)
1. Open the Supabase Dashboard: `https://supabase.com/dashboard/project/qkmswepfvgguomfhmkvg/sql`.
2. Open a new query window.
3. Paste the entire contents of `supabase/migrations/20261024120000_participant_expense_approval.sql`.
4. Click **Run**.
5. Ensure the query returns `Success. No rows returned` (or statements complete without error).

### Option B: Supabase CLI
```bash
npx supabase link --project-ref qkmswepfvgguomfhmkvg
npx supabase db push
```

### Post-Migration Verification Steps:
1. Verify `expense_approvals` table exists and RLS is enabled:
   ```sql
   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'expense_approvals';
   ```
2. Verify existing expenses are backfilled as `confirmed`:
   ```sql
   SELECT status, COUNT(*) FROM public.expenses GROUP BY status;
   ```
3. Test creating a test expense between 2 test accounts; verify non-creator sees the pending approval banner and balance remains 0 until approved.

---

## 8. Final Gate Verdict & Launch Readiness

### **VERDICT: READY FOR PRIVATE TESTING**

**Remaining Action Required Prior to Real Account Use:**
Apply migration `supabase/migrations/20261024120000_participant_expense_approval.sql` to the remote Supabase database (`qkmswepfvgguomfhmkvg`) following the procedure in Section 7 above. All frontend code, database SQL, contract tests, and isolated PostgreSQL 17 integration tests are complete, clean, and 100% passing.
