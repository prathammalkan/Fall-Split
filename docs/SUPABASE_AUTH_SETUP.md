# Supabase Auth Setup

## Dashboard Configuration Required

1. Go to: https://supabase.com/dashboard/project/qkmswepfvgguomfhmkvg/auth/url-configuration
2. Set the production Site URL to: https://fall-split.vercel.app (use localhost only for local development)
3. Add Redirect URLs:
   - http://localhost:5173/auth/callback
   - http://localhost:5173/reset-password
   - https://fall-split.vercel.app/auth/callback
   - https://fall-split.vercel.app/reset-password
   - https://fall-split.vercel.app
   - https://*.vercel.app/auth/callback
   - https://*.vercel.app/reset-password
4. Save changes.

## Email Templates

Go to: https://supabase.com/dashboard/project/qkmswepfvgguomfhmkvg/auth/templates

### Confirm Signup Template

The template must route through Supabase's verification endpoint or pass the token hash to the callback route.

- **Option 1 (Recommended — Standard Supabase Verification):**
  Use the default confirmation URL variable:
  ```html
  <h2>Confirm your signup</h2>
  <p>Follow this link to confirm your user:</p>
  <p><a href="{{ .ConfirmationURL }}">Confirm your mail</a></p>
  ```
  `{{ .ConfirmationURL }}` points to Supabase GoTrue (`/auth/v1/verify?token={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}`), which verifies the token server-side and redirects to the application's callback URL.
- **Option 2 (Direct SPA Token Hash):**
  If linking directly to the SPA callback, you MUST include `token_hash`:
  ```html
  <p>
    <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup"
      >Confirm your email</a
    >
  </p>
  ```
- **CRITICAL:** Do NOT use `{{ .SiteURL }}/auth/callback` without `token_hash` or `{{ .ConfirmationURL }}`. A bare URL contains no verification token and will result in expired/invalid link errors.

### Magic Link Template

Use `{{ .ConfirmationURL }}` or `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink`.

### Reset Password Template

Use `{{ .ConfirmationURL }}` or `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`.

## Google OAuth Setup

1. Go to: https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Web Application)
3. Add Authorized redirect URI: https://qkmswepfvgguomfhmkvg.supabase.co/auth/v1/callback
4. Copy Client ID and Secret
5. In Supabase dashboard > Authentication > Providers > Google: paste credentials

## Apple OAuth Setup

1. Requires Apple Developer account ($99/year)
2. Create App ID with Sign In with Apple capability
3. Configure Service ID with redirect URL: https://qkmswepfvgguomfhmkvg.supabase.co/auth/v1/callback
4. In Supabase dashboard > Authentication > Providers > Apple: paste credentials
