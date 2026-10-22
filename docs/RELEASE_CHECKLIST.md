# Release Checklist

## Completed Technical and Verification Gates

- [x] **Local source and build artifact verified**: TypeScript (`tsc --noEmit`), ESLint, Prettier (`prettier --check`), Vitest unit suite (27 test files, 202 tests passed, 0 failed), production build (`tsc -b && vite build`) generating 33 PWA precache entries, and npm production audit (0 high/critical vulnerabilities).
- [x] **Playwright browser smoke suite**: Desktop and mobile unauthenticated navigation, sign-in/registration navigation, and legal/support page access verified (4/4 passed).
- [x] **Database migration reconciliation**: Exactly 29 migrations in remote production database matched 1-to-1 against local `supabase/migrations/` (including recovered applied migration `20261022222143_reconcile_authenticated_app_table_privileges.sql`).
- [x] **Invitation generation defect identified and repaired**:
  - Root cause: Migration `20261023223000_narrow_authenticated_app_table_privileges.sql` revoked all privileges on `public.invitation_tokens` and granted only `UPDATE (revoked_at)`, omitting `INSERT` and `SELECT` for authenticated users. This caused `db.from('invitation_tokens').insert(...)` to fail with PostgreSQL 42501 (permission denied), displaying "Could not generate invite link. Please try again."
  - Forward-only repair migration `20261023230000_restore_authenticated_invitation_creation.sql` applied to production, restoring scoped column `INSERT` and `SELECT` privileges to `authenticated` while maintaining complete anonymous revocation and strict RLS/integrity trigger enforcement.
- [x] **Isolated authenticated transaction verification**:
  - Anonymous insert rejected: PostgreSQL 42501 (`permission denied for table invitation_tokens`).
  - Spoofed creator insert rejected: Active account / integrity check enforced.
  - Valid authenticated insert with matching `creator_id`: Succeeded and returned token.
  - Token creator select: Succeeded under RLS.
  - Cross-user token select: 0 rows returned under RLS (privacy preserved).
  - All test operations executed inside a transaction and rolled back with zero persistent rows written to production.
- [x] **Profile failure-state safeguard**: Single-flight retry mechanism and fallback UI added to `ProfilePage.tsx` and covered by `ProfilePage.test.tsx`.
- [x] **Production Vercel deployment and accessibility**:
  - Live URL `https://fall-split.vercel.app` verified returning `200 OK`.
  - Security headers active: Content Security Policy, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy: camera=(self), and Strict-Transport-Security.
  - PWA service worker (`/sw.js`) and manifest (`/manifest.webmanifest`) returning `200 OK`.
  - SPA client-side routes (`/privacy`, `/terms`, `/support`) returning `200 OK`.

## Public Launch Blockers (Operator / Legal Input Required)

- [ ] **Operator legal entity and business address**: Replace `[[LEGAL_ENTITY_NAME]]` and `[[BUSINESS_ADDRESS_OR_SERVICE_ADDRESS]]` in Privacy Policy and Terms & Conditions.
- [ ] **Monitored support and security contact addresses**: Replace `[[SUPPORT_EMAIL]]` and `[[SECURITY_CONTACT]]` in Contact & Support and Privacy Policy with verified monitored addresses.
- [ ] **Governing law and court jurisdiction**: Replace `[[GOVERNING_LAW_AND_JURISDICTION]]` in Terms & Conditions with counsel-approved jurisdiction.
- [ ] **Effective date**: Set `[[EFFECTIVE_DATE]]` to public launch date.
- [ ] **Supabase Auth leaked-password protection**: Enable leaked-password check in Supabase Auth dashboard settings.

## Current Release Status

**TECHNICALLY READY — PUBLIC LAUNCH BLOCKED BY LEGAL/OPERATOR INPUT**
All mandatory technical, build, migration, database security, and browser smoke test gates pass. Public release requires operator-supplied legal entity details and monitored contact addresses.
