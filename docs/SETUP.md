# Fall Split — Local Setup Guide

## Prerequisites

- Node.js v18+ (v20 recommended)
- npm v9+
- A Supabase project (free tier is sufficient)
- Git

## 1. Clone the repository

```bash
git clone https://github.com/prathammalkan/Fall-Split.git
cd Fall-Split
```

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your Supabase credentials (see [ENVIRONMENT.md](ENVIRONMENT.md)).

## 4. Set up Supabase

### 4.1 Select the existing Supabase project

Use the project already selected by the owner; do not create another project.
Confirm its display name, project reference, and region in the Supabase
Dashboard. In **Settings → API**, configure the **Project URL** and
**anon/public** key in `.env.local`. Keep database passwords and service-role
keys out of frontend variables.

### 4.2 Reconcile and apply database migrations

Install or invoke the official Supabase CLI:

```bash
npx supabase --version
```

Authenticate locally and link only after verifying the existing project's
reference:

```bash
npx supabase login
npx supabase link --project-ref <verified-existing-project-ref>
npx supabase migration list --linked
```

The production project has empty application tables and no Auth users after
the owner-authorized wipe. Its application schema remains in place, its
repository migration history is not reconciled, and no backup was retained as
directed. Do not apply migrations, run a linked reset, or execute migration SQL
in the production SQL Editor. `db:migrate` is preview-only; there is
intentionally no apply script while this release is blocked:

```bash
npm run db:migrate
```

Do not use the SQL Editor to replay migration files. The unsafe legacy custom
runner was removed because it had no migration ledger and retried selected SQL
errors. See
[`supabase/MIGRATION_RECONCILIATION.md`](../supabase/MIGRATION_RECONCILIATION.md)
for the existing-project procedure.

### 4.3 Configure Auth providers

**Email (required)**

- Supabase enables email auth by default.
- In **Authentication → Email Templates**, customize the confirmation and magic-link templates.
- Set the **Site URL** to `http://localhost:5173` for local development.
- Add `http://localhost:5173/auth/callback` to **Redirect URLs**.

**Google OAuth (optional)**

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the OAuth 2.0 API and create credentials.
3. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. In Supabase → **Authentication → Providers → Google**, enable and add your Client ID and Secret.

**Apple OAuth (optional)**

1. Requires an Apple Developer account ($99/year).
2. Create a **Services ID** and configure **Sign in with Apple**.
3. In Supabase → **Authentication → Providers → Apple**, add your credentials.
4. Apple requires HTTPS — will not work on `http://localhost`.

## 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## 6. Run tests

```bash
npm test
```

## 7. Type-check

```bash
npm run typecheck
```

## 8. Build for production

```bash
npm run build
```

The built output is in `dist/`.

## Troubleshooting

### "Missing Supabase environment variables"

Make sure `.env.local` exists and has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set.

### Auth redirect not working locally

Ensure `http://localhost:5173/auth/callback` is in your Supabase project's **Redirect URLs** list.

### "supabase db push" fails

Check that you are linked to the correct project (`supabase status`) and that your `SUPABASE_ACCESS_TOKEN` is set.
