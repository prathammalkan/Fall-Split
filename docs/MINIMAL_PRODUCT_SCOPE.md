# Fall Split — Minimal Product Specification & Scope

## 1. Executive Scope Statement

Fall Split is a **private-use expense-sharing Progressive Web App designed specifically for the developer and their friends**. It is intentionally constrained to be fast, secure, accurate, and dependable, replacing friction-heavy bill sharing with zero speculative complexity, zero gamification, and absolute financial ledger accuracy.

Because Fall Split is a private personal application and not a public commercial product:

- Legal entity placeholders and public corporate disclosures have been removed in favor of truthful private-project terms and developer direct contact information.
- Core focus is strictly placed on participant approval discipline, settlement confirmation safety, integer-paise financial reconciliation, and mobile PWA dependability.

---

## 2. Core Feature Matrix

### 2.1 Essential Features (Implemented & Verified)

| Feature                                      | Justification & Architectural Boundary                                                                                                                                                                                                                                                                                       | Implementation Status                                                                                                              |
| :------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **Intro Screen & Developer Credit (Req A)**  | Visible text `Developed by Pratham Malkan` rendered directly below Fall Split branding on app boot, with lightweight 800ms transition on initial session load and reduced-motion / test bypass.                                                                                                                              | **VERIFIED PASS** (`LoadingScreen.tsx`, `App.tsx`, `LoadingScreen.test.tsx`)                                                       |
| **Participant Approval Workflow (Req B)**    | Non-creator participants must review and approve shared expenses (`pending_approval`, `disputed`, `confirmed`, `cancelled`). Only `active` and `confirmed` expenses affect balances in `expense_pair_allocations`. Atomic `respond_to_expense_approval` RPC handles approvals and disputes with dispute category and reason. | **VERIFIED PASS** (`20261024120000_participant_expense_approval.sql`, `expenseApprovalMigration.test.ts`, `ExpenseDetailPage.tsx`) |
| **Contextual Confirmation Dialogs (Req C)**  | C1 pre-submission confirmation sheet dialog (`SheetDialog`) showing expense title, total, and personal share before submission; C2 final approval modal upon completing all participant approvals.                                                                                                                           | **VERIFIED PASS** (`AddExpensePage.tsx`, `ExpenseDetailPage.tsx`)                                                                  |
| **Settlement Confirmation Workflow (Req D)** | D1 two-step record payment confirmation sheet showing Recipient, Amount, and confirmation notice; D2 reported payment notice banner; D3 recipient response workflow (`Confirm Receipt` vs `Not Received`); reported payments never reduce ledger balances until recipient confirms.                                          | **VERIFIED PASS** (`FriendDetailPage.tsx`, `SettlementsPage.tsx`, `FriendDetailPage.test.tsx`)                                     |
| **Pending Actions Area (Req E)**             | Prominent section on Home screen surfacing expenses awaiting user approval, submitted expenses awaiting others, disputed expenses, and incoming/outgoing reported settlements, with an empty state ("All caught up! No pending approvals or settlements.").                                                                  | **VERIFIED PASS** (`HomePage.tsx`, `HomePage.test.tsx`)                                                                            |
| **Transparent Balance Breakdown (Req F)**    | Clear separation between Confirmed Ledger Balance (official ledger) and In-Flight / Pending Items (expenses awaiting approval, reported settlements) on Friend and Group detail pages.                                                                                                                                       | **VERIFIED PASS** (`FriendDetailPage.tsx`, `GroupDetailPage.tsx`, `FriendDetailPage.test.tsx`)                                     |
| **Private-Use Legal Terms (Section 6)**      | Removed all draft warnings and bracketed placeholders (`[[LEGAL_ENTITY_NAME]]`, `[[SUPPORT_EMAIL]]`, etc.) in `LegalPages.tsx`, replacing them with transparent private-project statements and developer contact (`pratham.malkan@gmail.com`).                                                                               | **VERIFIED PASS** (`LegalPages.tsx`, `LegalPages.test.tsx`)                                                                        |
| **Authentication & Session Lifecycle**       | Secure user identity using Supabase Auth (PKCE / GoTrue), session restoration on app load, email verification recovery, safe redirects (`isSafeRedirect`), and sign-out.                                                                                                                                                     | **VERIFIED PASS** (`AuthContext.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, `AuthCallbackPage.tsx`)                                 |
| **Account Lifecycle & Deletion**             | Secure RPC `delete_account()` anonymizing ledger entries and detaching identity while preserving mathematical ledger balance integrity for other users.                                                                                                                                                                      | **VERIFIED PASS** (`accountDeletion.ts`, `008_delete_account_rpc.sql`)                                                             |
| **Friend Requests & User Discovery**         | Username prefix search with debouncing, request send/accept/reject/cancel lifecycle, and mutual friendship enforcement.                                                                                                                                                                                                      | **VERIFIED PASS** (`FriendsPage.tsx`, `SearchPage.tsx`, `015_relationship_authorization.sql`)                                      |
| **Invitations & QR Code Sharing**            | Cryptographically secure 32-byte invitation tokens, unguessable URLs, in-app QR code display, clipboard copy, native Web Share API, and in-app camera QR scanning (`InviteQrScanner.tsx`).                                                                                                                                   | **VERIFIED PASS** (`ShareInviteModal.tsx`, `InvitePage.tsx`, `inviteUrl.ts`)                                                       |
| **Groups & Membership**                      | Atomic group creation with creator as admin (`create_group_with_owner`), group member listing, and identity-bound self-removal (`leave_group`).                                                                                                                                                                              | **VERIFIED PASS** (`CreateGroupPage.tsx`, `GroupsPage.tsx`, `GroupDetailPage.tsx`, `011_group_balance_membership_guard.sql`)       |
| **Expense Creation & Multi-Split**           | Single atomic RPC submission (`create_expense_with_records`) ensuring atomic writes to `expenses`, `expense_payers`, and `expense_shares`. Supports equal splits (with paise largest-remainder allocation) and custom unequal splits.                                                                                        | **VERIFIED PASS** (`AddExpensePage.tsx`, `splits.ts`, `016_atomic_expense_creation.sql`)                                           |
| **Owner-Only Expense Deletion**              | Only the original expense creator may delete an expense (`delete_expense`). Enforced via pair advisory locks (`pg_advisory_xact_lock`), pending-settlement checks, child-record cleanup, and append-only audit trail in `expense_history`.                                                                                   | **VERIFIED PASS** (`ExpenseDetailPage.tsx`, `20261024100000_owner_only_expense_deletion.sql`)                                      |
| **Persisted Financial Ledger & Balances**    | Integer paise representation (1 INR = 100 paise), database-computed pair balances (`get_friend_balances`, `get_group_balances`), and zero-sum balance invariants.                                                                                                                                                            | **VERIFIED PASS** (`money.ts`, `balances.ts`, `005_fix_friend_balances.sql`, `006_fix_accept_invitation_and_group_balances.sql`)   |
| **Activity History & Export**                | Filterable unified activity timeline (expenses and settlements), correct signed debtor/creditor semantics, and sanitised CSV export resisting formula injection.                                                                                                                                                             | **VERIFIED PASS** (`ActivityPage.tsx`)                                                                                             |
| **PWA & Mobile Navigation**                  | Installable web manifest, standard 192/512/maskable icons, Workbox service worker precaching, fixed safe-area bottom navigation, and offline status banner.                                                                                                                                                                  | **VERIFIED PASS** (`vite.config.ts`, `vercel.json`, `useOnlineStatus.tsx`)                                                         |

---

## 3. Conditionally Retained Existing Features

| Feature                            | Condition for Retention                                                                    | Assessment                                                                                                       | Decision   |
| :--------------------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--------- |
| **Itemized Expenses**              | Retain only if atomic database write exists and child records reconcile with total amount. | Fully supported by `create_itemized_expense_with_records` RPC, item ordering, allocation constraints, and tests. | **RETAIN** |
| **Multiple Payers**                | Retain only if payer contributions reconcile to expense total.                             | Verified by `validateMultiplePayers()` and database check constraints.                                           | **RETAIN** |
| **Offline Expense Creation Queue** | Retain only if IndexedDB queue isolates accounts and does not fabricate server success.    | IndexedDB `offlineQueue.ts` strictly isolated per `user_id` and wiped on account deletion/sign-out.              | **RETAIN** |
| **In-App QR Scanner**              | Retain only if camera stream cleanly releases and invalid codes do not crash the app.      | Verified by `InviteQrScanner.test.tsx` (5/5 unit tests pass, proper track stopping on cleanup).                  | **RETAIN** |
| **UPI Deep Links**                 | Retain only as an informational convenience that does not alter settlement state.          | `FriendDetailPage.tsx` constructs URI but never marks settlement confirmed without explicit confirmation.        | **RETAIN** |

---

## 4. Deferred Features & Out-of-Scope Roadmap

The following capabilities are deliberately **excluded** to keep Fall Split minimal, secure, and maintainable for private use:

1. **Third-party bank integrations / Payment Gateway APIs**: (Stripe, Razorpay, Plaid) — increases regulatory, KYC, and security surface; Fall Split is a peer-to-peer ledger, not a payment transmitter.
2. **AI Categorization / Receipt OCR**: Bloats client bundle and introduces non-deterministic parsing errors into a financial ledger.
3. **Social feeds / Public Comments / Chat**: Unnecessary attack surface; communication occurs in person or through messaging apps.
4. **Multi-Currency Dynamic Conversion**: Floating FX rates introduce rounding drifts; Fall Split strictly models transactions in Indian Rupee (paise integers).
5. **Gamification / Badges / Streaks**: Distracts from clear financial settlement utility.
6. **Complex Group Hierarchies / Multi-Role Permissions**: The current two-tier system (admin/creator vs. member) is sufficient and easily audited.

---

## 5. Candidate Cleanup & Dead Code Inventory

- **Starter files & unused styles**: Previously removed (`App.css`, unused Vite SVGs, unreferenced icons).
- **Duplicate Docs**: Consolidated into canonical `docs/` paths; legacy redundant deployment files removed.
- **Unused dependencies**: `@supabase/auth-helpers-react`, `qrcode`, and `workbox-build` were cleanly purged.
- **Prettier & TypeScript checks**: All current 36 test suites and production source files pass format and typecheck with zero dead imports.
