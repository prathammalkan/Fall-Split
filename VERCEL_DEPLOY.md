# Vercel Deployment

## One-Click Deploy
1. Go to: https://vercel.com/new
2. Import: https://github.com/prathammalkan/Fall-Split
3. Framework: Vite (auto-detected)
4. Build Command: npm run build
5. Output Directory: dist
6. Install Command: npm ci

## Environment Variables
Add these in Vercel project settings:
```
VITE_SUPABASE_URL=https://qkmswepfvgguomfhmkvg.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrbXN3ZXBmdmdndW9tZmhta3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNjUxNjksImV4cCI6MjEwNzk0MTE2OX0.NJ5ivvloKJSfMo7HapqjinZ99YCd7ih8uG-oHz4KjUw
VITE_APP_URL=https://fallsplit.vercel.app
```

## After Deploy
1. Copy your Vercel URL (e.g. https://fall-split-xyz.vercel.app)
2. In Supabase Auth > URL Configuration:
   - Update Site URL to your Vercel URL
   - Add /auth/callback to redirect URLs
3. The PWA can be installed from the browser (Add to Home Screen)
