# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Part A (design tokens, i18n, theme-preview prototypes) has merged to `main` (PR #19). Part B (auth proxy, schema migration, check-in/profile types, `work_stats` aggregation) has merged to `main` (PR #20). Part C (caching, perf, image/POI security) is implemented on `feat/impl-caching-perf-security` and pending review/PR. Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

## Active focus

- Part C review/merge: `feat/impl-caching-perf-security` (PR #21) — long-cache headers in `web/next.config.ts`, Serwist runtime cache tuning in `web/app/sw.ts`, query-persistence buster and restore-error handler, 10 MB image upload cap with R2 lifecycle guidance, `maps_share_url` domain validation in `/api/places/resolve`, nearby search 10 km cap, and per-user rate limiting for image/POI routes.
- Owner credential/account actions remain outstanding and are tracked in `docs/agent/pending-user-actions.md`.

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — 4-table schema (spec 0001)
web/lib/auth/            Supabase server client (PKCE), profile upsert logic
web/lib/db/              Postgres pool (server-side only)
web/app/auth/            signIn/signOut server actions + OAuth callback route
web/lib/images/          image-service client + sharp processor + 10 MB upload size propagation
web/app/api/images/      upload + complete route handlers with per-user rate limiting
poi-service/             POI cache microservice (Workers + D1 + KV) — 4 endpoints,
                         Google field masks, KV hot cache, D1 store, haversine search
image-service/           Image upload microservice (Cloudflare Worker + R2 presigned URLs,
                         10 MB cap, lifecycle guidance)
web/lib/places/          Server-only POI service client (search/resolve/get) + maps URL validator
web/app/api/places/      search + resolve route handlers with rate limiting, 10 km radius cap,
                         and maps URL domain validation
web/lib/rate-limit.ts    In-memory token-bucket rate limiter + client identifier helper
web/next.config.ts       Long immutable Cache-Control headers for static/PWA assets
web/app/sw.ts            Serwist runtime cache (CacheFirst for immutable assets, NetworkOnly for
                         dynamic pages and API routes)
web/types/places.ts      POI types shared with the worker
docs/specs/              0001 Next.js rewrite, 0002 design system, 0003 testing/CI
docs/agent/              slices manifest (machine-checked), this file, protocols
.agents/                 Agent workflows, scripts, delegated design prompts
_archive-coffeemode-frontend/  old Vite app — reference only, superseded
_archive-coffeemode-backend/   old Java app — being dropped
```

## What's next

```text
1. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   redirect URLs, Apple/Google provider config, self-hosted Postgres provision +
   schema (DATABASE_URL), Google OAuth, Apple Developer Program.
2. image-service deploy (§6): create R2 bucket + S3 API token, set R2_ACCOUNT_ID
   in wrangler.toml, set Worker secrets, deploy, wire IMAGE_SERVICE_URL/TOKEN.
3. poi-cache-service deploy (§7): Cloudflare D1/KV + secrets, apply D1 schema,
   deploy, wire POI_SERVICE_URL/TOKEN.
4. map-home — Apple MapKit full-screen map + custom markers  [BLOCKED on Apple Developer Program]
5. discovery-sheet — bottom sheet + swipe cards  [BLOCKED on map-home]
6. cafe-creation — first check-in flow  [BLOCKED on discovery-sheet; also needs auth-foundation round-trip + image-service deploy per pending-user-actions.md]
7. checkin-system — 0-100 sliders + policy chips  [BLOCKED on cafe-creation]
8. work-profile aggregation, search, navigation prompt  [BLOCKED on checkin-system]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- DATABASE_URL (self-hosted Postgres) not configured anywhere
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh proxy implemented (`web/proxy.ts`); first protected route can now rely on it
- Rate limiter is in-memory / per-process; replace with a Redis/KV-backed limiter before horizontal scaling
- `next build` warns about custom Cache-Control for `/_next/static/:path*` — intentional for production hashed chunks
- `maps_share_url` host validation, 10 km nearby-search cap, and 10 MB image-upload cap are active
- R2 lifecycle cleanup for abandoned `original/` objects requires a scheduled Worker/script (metadata rules cannot filter)
- Apple Developer Program purchase pending (needed for MapKit JS)
- poi-service/wrangler.toml has placeholder KV/D1 ids; deploy blocked on
  Cloudflare account + secrets (pending-user-actions §7)
- image-service/wrangler.toml needs R2 bucket name and R2_ACCOUNT_ID in [vars]; IMAGE_SERVICE_TOKEN, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set via wrangler secret put
```

## Latest review

A batched subagent review (frontend/UX, check-in/social, cafe creation/discovery, auth/cache/perf/DB/deploy) produced `docs/specs/0004-product-decisions-and-backlog.md`. It contains proposed product decisions, an implementation backlog split into four phases, and open questions that need owner confirmation before they become canonical.
