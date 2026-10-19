# Fall Split — PWA Guide

## What Makes Fall Split a PWA

- **Installable** — Add to home screen on Android and iOS
- **Offline-capable** — Core UI works without internet; expenses queue for sync
- **Service worker** — Managed by Workbox via `vite-plugin-pwa`
- **Web manifest** — `manifest.webmanifest` with icons, colors, display mode
- **HTTPS required** — Service workers only work on HTTPS (or localhost)

## Installing the App

### Android (Chrome)
1. Open the app in Chrome.
2. Tap the three-dot menu → **Add to Home screen**.
3. Or wait for the install prompt banner.

### iOS (Safari)
1. Open the app in Safari.
2. Tap the **Share** button (box with arrow).
3. Tap **Add to Home Screen**.
4. Tap **Add**.

> Note: iOS PWA support is limited. Push notifications are not supported on iOS. The offline queue works, but background sync is not available.

## Offline Behavior

When the device is offline:

- Previously loaded pages display from the service worker cache.
- Expense creation is queued in **IndexedDB** (the offline outbox).
- Queued operations sync automatically when connectivity is restored.
- Each queued operation has an **idempotency key** — duplicate submissions are safe.

### Offline queue states

| State | Description |
|---|---|
| `pending` | Queued, not yet attempted |
| `syncing` | Currently uploading |
| `synced` | Successfully saved to server |
| `failed` | Upload failed; will retry |
| `conflict` | Server rejected due to conflict; requires manual resolution |

## Service Worker Strategy

Precached (on install):
- All JS, CSS, HTML, and icon assets
- `index.html` as the navigation fallback

Runtime caching:
- Google Fonts — `CacheFirst`, 1 year
- Navigation requests — served from `index.html` (SPA routing)

Excluded from service worker interception:
- `/api/*`, `/rest/*`, `/auth/*` — always go to the network

## Icons

All icon sizes are in `public/icons/`:

| File | Size | Purpose |
|---|---|---|
| `icon-72x72.png` | 72×72 | Legacy Android |
| `icon-96x96.png` | 96×96 | |
| `icon-128x128.png` | 128×128 | Chrome Web Store |
| `icon-144x144.png` | 144×144 | IE11 |
| `icon-152x152.png` | 152×152 | iOS |
| `icon-192x192.png` | 192×192 | Android home screen |
| `icon-384x384.png` | 384×384 | Splash screen |
| `icon-512x512.png` | 512×512 | PWA splash |
| `icon-512x512-maskable.png` | 512×512 | Adaptive icon (Android) |

`public/apple-touch-icon.png` — 180×180 — Used by iOS Safari.

To regenerate icons (e.g., after changing the logo):
```bash
node scripts/generate-icons.mjs
```

## Manifest

The manifest is configured in `vite.config.ts` under `VitePWA({ manifest: ... })`.

Key properties:
- `display: 'standalone'` — App has no browser chrome
- `theme_color: '#0a0a0a'` — Status bar color on Android
- `background_color: '#0a0a0a'` — Splash screen background
- `start_url: '/'` — Opens to home screen
- `orientation: 'portrait-primary'`

## Updating the App

When a new version is deployed:
1. The service worker detects the change.
2. It installs in the background (`skipWaiting: true`).
3. On next navigation, the new version activates.
4. Users may need to refresh once to see updates.
