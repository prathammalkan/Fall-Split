# Fall Split

Fall Split is a modern expense-splitting Progressive Web App for shared bills, group balances, settlements, and activity tracking.

## What it does

- Track shared expenses and split them across participants
- Support multiple split methods and currency-safe money logic
- Maintain per-person balances and settlement flows
- Allow group and friend-based sharing with invitation flows
- Support offline queueing and synchronization for resilient usage
- Run as a PWA with installable mobile-friendly UX

## Stack

- React + TypeScript
- Vite
- Tailwind CSS
- Supabase Auth + PostgreSQL
- Workbox/PWA support
- Vitest for unit tests

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in the browser-safe values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL`
   - Optional notification and monitoring keys
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

## Available scripts

```bash
npm test
npm run typecheck
npm run build
npm run lint
npm run dev
```

## Environment guidance

- Keep all browser-exposed variables prefixed with `VITE_`.
- Keep server-only values such as `SUPABASE_SERVICE_ROLE_KEY` outside the browser bundle.
- Never commit `.env.local` or other live credentials.

## Security and operations

- Review the Supabase security configuration in the database migrations and Edge Functions before production deployment.
- Keep any service-role or admin credentials in Supabase secrets or a secure deployment environment only.
- See [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md), and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for project-specific configuration guidance.
- Setup, testing, PWA, database, backup/recovery, and release documentation lives under [`docs/`](docs/).
- User-facing Privacy, Terms, and Support pages are available in the app at `/privacy`, `/terms`, and `/support`; these remain drafts until the bracketed operator details and legal review are complete.
- Third-party production dependency licenses are summarized in [`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md). Fall Split itself has no project-level license declared yet.

## Existing Supabase project

Use the existing Supabase project selected by the owner; do not create another
project. Verify its Dashboard identity, API URL, `.env.local` project
reference, and linked CLI target before any database operation. If the CLI is
not authenticated, run `supabase login` locally; do not share an access token.

The owner explicitly authorized permanent deletion of all application data in
the existing production project. The 17 application tables and 3 Auth users
are empty; the application schema remains and the repository migration ledger
is not established. No backup was retained, as directed. Deleted application
rows and Auth users cannot be restored from this repository or a code rollback.
Do not apply migrations or run a linked reset until schema effects are
reconciled, a disposable PostgreSQL run passes, a production maintenance barrier
is in place, and the operator has explicit final authorization. See
[`supabase/MIGRATION_RECONCILIATION.md`](supabase/MIGRATION_RECONCILIATION.md).
The Supabase CLI is pinned as a development dependency. After those
prerequisites are satisfied, use the supported CLI workflow:

```bash
npx supabase login
npx supabase link --project-ref <verified-existing-project-ref>
npm run db:migration:list
npm run db:migrate
npm run db:migration:list
```

`npm run db:migrate` is preview-only and cannot apply migrations. No apply
script is provided while the production baseline remains unreconciled.

The reviewed repository chain currently runs through migration `018`, with
`20261021223159_preserve_anonymized_ledger_identity.sql` and
`20261021225434_revoke_excessive_app_table_privileges.sql` prepared as forward
migrations but not yet applied. Stop if the migration list or dry run includes
an unexpected version. Verify the resulting schema, policies, functions,
grants, and triggers before application tests. The unsafe legacy runner was
removed because it had no migration ledger and retried selected SQL errors.

Configure the Auth Site URL to the app origin and allow the app's
`/auth/callback` and `/reset-password` redirects. Configure email verification,
password recovery, and production-quality SMTP before accepting real users.
Set up Google or Apple provider credentials and redirect allowlists only if
those sign-in methods will be offered. Deploy the `delete-account` Edge
Function with JWT verification enabled and its service-role secret available
only server-side. Current application code does not require a Storage bucket
or scheduled database job.

The browser build needs only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
the app's `VITE_APP_URL`; the anon key is public, but the service-role key is
not. Configure matching production values only as a separately authorized
cutover after staging flows pass. A frontend rollback cannot restore deleted
database rows.
Do not change project URLs as a workaround: accounts, passwords, sessions,
invitations, expenses, and settlement history do not transfer automatically.

## Notes

This repository includes a local migration set under `supabase/migrations/` and a set of operational scripts under `scripts/` for database and auth troubleshooting. These scripts now rely on environment variables instead of embedded credentials.
