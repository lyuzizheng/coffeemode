# 0003. PWA Service Worker Architecture

## Status

Accepted

## Context

CoffeeMode is a map-native mobile web app. The user wants it to be installable on iOS/Android home screens and to launch fast. The original MVP spec said "manifest + standalone display mode + icons. No service worker." That gives installability but not fast repeat launches or offline resilience.

We need a single, minimal service worker that improves perceived performance without degrading the user experience, complicating the build, or creating data-consistency risks.

## Decisions

### 1. Service worker implementation: `@serwist/turbopack`

Use `@serwist/turbopack` to generate the service worker. It supports Next.js 16's default Turbopack without forcing webpack, and it auto-generates the precache manifest from the build output. The SW is served from a Serwist route handler.

### 2. Precache scope: app shell

In addition to the build assets that Serwist precaches automatically (`/_next/static/*`), explicitly precache `/~offline`. The home page (`/`) is dynamic because it reads the Supabase session from cookies, so precaching it would cache user-specific HTML. Icons and fonts are immutable and cached at first runtime access; precaching them is unnecessary install bloat.

### 3. Runtime caches

| Route pattern | Strategy | TTL / limit | Rationale |
| --- | --- | --- | --- |
| `/` (document navigation) | `NetworkOnly` | — | Dynamic page that reads the Supabase session from cookies; offline fallback handles failed navigation |
| `/_next/static/*` | `CacheFirst` | 1 year (immutable hashes) | Build assets never change without a new hash |
| `/icons/*`, `/fonts/*` | `CacheFirst` | 1 year | Static assets |
| `images.coffeemode.app/**/*.webp` | `CacheFirst` | 200 entries, 30 days LRU | R2 image variants are immutable after processing; serve from cache first, no revalidation round-trip |
| `/api/*` (all API routes) | `NetworkOnly` | — | Supersedes the earlier per-route rows: API GETs are user-specific/volatile, and serwist's `defaultCache` has a 24h NetworkFirst `apis` catch-all that ignores `Cache-Control: no-store` — a catch-all network-only rule in `RUNTIME_RULES` must win first (issue #46) |
| `/auth/*` | `NetworkOnly` | — | Auth must not be cached |
| `/serwist/sw.js`, `/manifest.webmanifest` | `NetworkOnly` | — | Always fetch fresh worker/manifest |

### 4. Images: keep `next/image`, custom loader for R2

Next.js `<Image>` stays enabled for future non-R2 images. For the immutable R2 WebP variants (`original`, `card`, `thumbnail`), use a custom loader that returns the direct R2 URL. This avoids `Accept`-header cache-key complexity at the CDN and lets Cloudflare cache the direct R2 URLs long-term.

R2 PUTs for `original`, `card`, and `thumbnail` variants include `Cache-Control: public, max-age=31536000, immutable` so the CDN and browser treat them as immutable.

### 5. TanStack Query persistence: essentials only

Persist only user profile, currently-viewed cafe detail, and nearby cafe list in IndexedDB. Closing the tab and reopening restores the last viewed cafe and nearby search, but check-in lists and recent searches are re-fetched. This keeps the persisted store small and simple.

Query keys are flat: `['profile']`, `['cafes-list', hash]`, `['cafe', id]`, `['cafe-checkins', id]`, `['navigations-pending']`.

### 6. `cafes.work_stats` concurrency: do nothing at MVP

Lost-update races are accepted at MVP scale. The nightly `work_stats` recompute cron corrects drift. If check-in concurrency becomes observable, add `work_stats.version` optimistic locking as a follow-up.

### 7. Offline UX: browser + SW ping, passive banner

The app listens to `window` online/offline events and performs a lightweight periodic health ping (or lets the SW report real fetch failures). A passive banner reads "Connection unstable — some info may be outdated." Write operations fail inline with a user-visible message; no offline mutation queue.

### 8. Build and CI: build + Dockerfile + artifact check

- `next build` emits the SW at `.next/server/app/serwist/sw.js.body` and the manifest at `.next/server/app/manifest.webmanifest.body` via `@serwist/turbopack`.
- `web/Dockerfile` builds standalone and copies `public/` + `.next/static/` into `.next/standalone/`.
- `.github/workflows/application.yml` verifies the Serwist SW and manifest route outputs exist after build.

### What the service worker does NOT do

- No background sync or offline mutation queue.
- No push notifications (post-MVP).
- No map tile caching (Apple MapKit JS is CDN-based and offline tiles are unrealistic).
- No `CacheFirst` for API routes that must be fresh (auth, upload, places proxy).

## Consequences

- First repeat launch is fast because the app shell and static assets are local.
- Cached cafe data/images load instantly; fresh data loads in the background.
- `@serwist/turbopack` adds a small dependency but removes the need for a custom precache manifest script.
- `next.config.ts` must add `headers()` for `/serwist/sw.js` (`no-cache`) and `Service-Worker-Allowed: /` because the SW is served from `/serwist/sw.js`.
- Cloudflare Cache Rules must long-cache `/_next/static/*`, direct R2 image URLs, and icons/fonts; bypass `/serwist/sw.js`, `/manifest.webmanifest`, and `/api/*`.
- `next/image` with a custom R2 loader keeps optimization available while avoiding double-optimization of already-resized WebP variants.

## Related

- `docs/specs/0001-nextjs-migration.md` §PWA & sharing
- `docs/specs/0001-nextjs-migration.md` §Data fetching (TanStack Query + IndexedDB persistence)
