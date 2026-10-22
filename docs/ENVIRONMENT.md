# Fall Split — Environment Variables

All environment variables used by Fall Split are prefixed `VITE_` (exposed to the browser bundle) or have no prefix (build-only). No secret service-role keys ever belong in `VITE_` variables.

## Required Variables

| Variable | Description | Example |
|---|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL | `https://xyzabc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (safe for browser) | `eyJh...` |

## Optional Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_APP_URL` | Public app origin used by shareable invitation links and QR codes. Required in production and for preview deployments; production must use HTTPS. | Empty locally (uses the current localhost development origin) |
| `VITE_APP_NAME` | Application name override | `Fall Split` |

## Variables That Must NEVER Appear in VITE_ Prefix

| Variable | Description |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Grants admin access to your DB. Only for server-side/Edge Functions. |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token. Never in source code. |

> **Warning:** Any variable prefixed `VITE_` is embedded in the browser bundle and is publicly visible. Never put service-role keys, database passwords, or other secrets in `VITE_` variables.

## Setting Up

1. Copy `.env.example` to `.env.local`:
 ```bash
 cp .env.example .env.local
 ```
2. Fill in the values from your Supabase dashboard (**Settings → API**).
3. `.env.local` is in `.gitignore` — it will never be committed.

## Deployment

On Vercel:
1. Go to your project → **Settings → Environment Variables**.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Add `VITE_APP_URL` set to your production domain (e.g., `https://fallsplit.vercel.app`).
4. Redeploy for changes to take effect.

## Local Files

- `.env.example` — Template with placeholder values. **Committed to Git.**
- `.env.local` — Your actual secrets. **Never committed.**
- `.env.production` — Production overrides if needed. **Never committed.**
