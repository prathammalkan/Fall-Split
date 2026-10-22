# Supabase Auth Setup

## Dashboard Configuration Required
1. Go to: https://supabase.com/dashboard/project/qkmswepfvgguomfhmkvg/auth/url-configuration
2. Set Site URL: http://localhost:5173 (change to Vercel URL after deploy)
3. Add Redirect URLs:
   - http://localhost:5173/auth/callback
   - https://fallsplit.vercel.app/auth/callback  
   - https://fallsplit.vercel.app
   - https://*.vercel.app/auth/callback
4. Save changes.

## Email Templates
Go to: https://supabase.com/dashboard/project/qkmswepfvgguomfhmkvg/auth/templates
Ensure the Confirm Signup and Magic Link templates use: {{ .SiteURL }}/auth/callback

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
