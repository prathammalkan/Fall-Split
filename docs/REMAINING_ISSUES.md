# Remaining Issues

## Release blockers

1. Production migration reconciliation and safe schema rollout
   - Read-only Supabase connector and CLI checks confirm the existing production project is active, its 17 application tables are empty with RLS enabled, and the remote migration list is empty. Supabase CLI 2.121.0 is pinned. PostgreSQL 17.11 is installed; a separate temporary localhost cluster was used for repository migration and repair tests without connecting to the installed password-protected service.
   - Migrations `013`-`018` and timestamped forward migrations `20261021223159_preserve_anonymized_ledger_identity.sql` and `20261021225434_revoke_excessive_app_table_privileges.sql` are not applied or verified against PostgreSQL. A reviewed baseline, staging verification, and an externally enforced API maintenance barrier are required before any production DDL.
   - The consolidated SQL artifact is `READY FOR ISOLATED SUPABASE TESTING`: it passed on PostgreSQL 17.11 against a representative migrations-001–012 fixture with a local Auth shim, including full repair postconditions, forced transaction rollback, and fail-closed rerun. This is not a full Supabase or production clone; do not execute it in production.

2. Production RPC and authorization drift
   - The live catalog lacks `get_profile_for_user`, `get_settlement_recipient_upis`, `create_expense_with_records`, and `create_itemized_expense_with_records`, although the frontend calls them. Existing production `SECURITY DEFINER` functions use `search_path=public`; several internal helpers and mutations remain executable by `anon`. Both `anon` and `authenticated` also have `TRUNCATE`, `TRIGGER`, `REFERENCES`, and PostgreSQL 17 `MAINTAIN` on all 17 app tables. RLS does not filter whole-table `TRUNCATE` or `REFERENCES`. The pending forward migration `20261021225434_revoke_excessive_app_table_privileges.sql` removes direct `PUBLIC`/`anon` table grants and those high-risk direct grants from `authenticated`. The repair postconditions checked direct/default privilege state on local PostgreSQL; verify inherited role privileges and Data API/PostgREST behavior in Supabase before rollout. The live expense participant policy compares payer/share IDs to themselves, so individual participants may not be able to read their expenses. These catalog findings have not been exercised as authenticated/anonymous PostgreSQL scenarios.
   - The live `profiles.id` foreign key to `auth.users.id` is `ON DELETE CASCADE`; the local retention migration that removes it has not been applied. The production project currently has no deployed Edge Functions, including the required `delete-account` function.

3. Production account-deletion behavior remains unverified
   - The local flow anonymizes the profile, clears that user's local offline expenses, and then calls the Auth deletion Edge Function. The prepared migration detaches `profiles.id` from `auth.users` so financial and audit references remain.
   - Verify on an isolated Supabase branch that Auth deletion succeeds, the tombstoned profile and all ledger references remain, stale JWTs cannot read or mutate application data, and signup still creates profiles.

4. Partial local PostgreSQL verification only
   - All 20 repository migrations and the repair passed on disposable PostgreSQL 17.11 with a minimal Auth shim. Local smoke checks covered expense/itemized RPCs, conservation, idempotency, creator spoof denial, selected profile RLS, rollback, and rerun rejection. Six opt-in Supabase API integration tests remain skipped. Settlement concurrency, full deletion retention, friendship/invitation/group authorization, and the complete RLS matrix still require isolated Supabase testing.

5. Production API maintenance barrier and deployment
   - No external barrier has been configured or tested. Do not apply the unreconciled migration chain or deploy frontend/Edge Function changes until a barrier blocks direct PostgREST/RPC and Edge Function traffic during schema transition.
   - The user reports that Vercel Git auto-deploy, Google OAuth, and Supabase email are configured. The Vercel connector currently requires reauthentication; this workspace has not performed provider end-to-end checks, Git push, or deployment.

6. Client verification
   - The local production-preview browser smoke test and real-device install/offline checks were not run. Browser policy denied access to the localhost preview; device checks need a supported browser/device.

7. Legal, support, and distribution details
   - `/privacy`, `/terms`, and `/support` are implemented and linked, but deliberately marked draft. Replace `[[LEGAL_ENTITY_NAME]]`, `[[BUSINESS_ADDRESS_OR_SERVICE_ADDRESS]]`, `[[SUPPORT_EMAIL]]`, `[[SECURITY_CONTACT]]`, `[[EFFECTIVE_DATE]]`, `[[SUPABASE_REGION_AND_TRANSFER_DETAILS]]`, and `[[GOVERNING_LAW_AND_JURISDICTION]]` with owner-verified details and obtain legal approval.
   - `docs/THIRD_PARTY_NOTICES.md` lists the 31 production dependency entries and includes available license texts. `qrcode-generator@2.0.4` declares MIT but has no license file in the installed package; verify and add its upstream notice. There is no Fall Split `LICENSE`; the project owner must choose a license or confirm proprietary distribution terms.

## Follow-up risks

- IndexedDB retains pending outbox records after ordinary sign-out so users do not lose unsynchronized expenses. Synchronization is owner-filtered and account deletion clears the deleted user's queued operations. Shared-device users should be told to sign out; local outbox encryption is not implemented.
- The owner reports that the database password previously exposed in committed Git history has been rotated. Treat the historical value as revoked based on that report; there is no current evidence the replacement was exposed, so do not rotate it again absent such evidence. Verify authorized direct-connection consumers were updated. The old value remains in Git history until coordinated history cleanup and collaborator clone refresh; neither has been performed. Editing the working tree does not erase historical copies.
- Verify role-specific and inherited `PUBLIC` grants plus Data API behavior for the new table-privilege migration on PostgreSQL 17 before rollout.
- The opt-in integration suite does not yet cover every settlement concurrency, split pairwise rounding, or failure-recovery scenario listed in `supabase/MIGRATION_RECONCILIATION.md`.
