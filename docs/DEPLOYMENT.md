# Fall Split — Deployment Guide

## Recommended: Vercel

Fall Split is configured for zero-configuration Vercel deployment.

### Deploy in 3 steps

1. **Fork or push** this repository to GitHub.

2. **Import** the project on [vercel.com/new](https://vercel.com/new):
 - Framework preset: **Vite**
 - Build command: `npm run build`
 - Output directory: `dist`

3. **Set environment variables** in Vercel → Settings → Environment Variables:
 ```
 VITE_SUPABASE_URL = https://yourproject.supabase.co
 VITE_SUPABASE_ANON_KEY = eyJh...
 VITE_APP_URL = https://your-app.vercel.app
 ```

4. Deploy. Vercel will auto-deploy on every push to `main`/`master`.

### What `vercel.json` configures

- **SPA rewrite**: all routes redirect to `index.html` so client-side routing works.
- **Security headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Content security**: a restrictive Content-Security-Policy allows the app, Supabase API/WebSockets, and Google Fonts.
- **Asset caching**: `/assets/*` files are cached immutably for 1 year (content-hashed filenames).
- **Service worker**: `sw.js` served with `no-cache` and `Service-Worker-Allowed: /`.
- **PWA manifest**: `manifest.json` served with correct MIME type.

## Supabase Configuration for Production

### Auth Redirect URLs

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs** (add all):
 - `https://your-app.vercel.app/auth/callback`
 - `https://your-app.vercel.app/reset-password`
 - `http://localhost:5173/auth/callback` (for development)

### OAuth Providers

For Google and Apple OAuth, update the authorized redirect URIs to point to your Supabase project's auth callback:
```
https://<project-ref>.supabase.co/auth/v1/callback
```

This is the Supabase callback, not your app's callback. Supabase handles the OAuth flow and then redirects to your app.

### Row Level Security

RLS is enabled on all tables. Verify it is active:

```sql
-- Run in Supabase SQL Editor
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

All tables should show `rowsecurity = true`.

## Alternative: Self-hosted / Docker

Fall Split is a static SPA and can be served from any web server:

```bash
npm run build
# Serve the dist/ directory from nginx, Apache, Caddy, etc.
```

Example nginx config:

```nginx
server {
 listen 80;
 root /var/www/fallsplit/dist;
 index index.html;

 # SPA routing
 location / {
 try_files $uri $uri/ /index.html;
 }

 # Cache hashed assets
 location /assets/ {
 expires 1y;
 add_header Cache-Control "public, immutable";
 }

 # Service worker — no cache
 location /sw.js {
 add_header Cache-Control "no-cache, no-store, must-revalidate";
 }
}
```

## CI/CD: GitHub Actions

The `.github/workflows/ci.yml` pipeline runs on every push and PR:

1. **Type-check** — `tsc --noEmit`
2. **Lint** — ESLint (blocking)
3. **Unit tests** — Vitest
4. **Build** — Vite production build
5. **Upload artifact** — `dist/` kept for 7 days

To enable the CI, add these secrets in GitHub → Settings → Secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

> Note: Pushing `.github/workflows/ci.yml` requires a GitHub token with the `workflow` scope. Use a Personal Access Token (PAT) with `repo` + `workflow` scopes, or use the GitHub web UI to create/edit the file.
