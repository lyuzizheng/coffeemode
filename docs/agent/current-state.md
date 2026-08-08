# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Part A (design tokens, i18n, theme-preview prototypes), Part B (auth proxy, schema migration, check-in/profile types, `work_stats` aggregation), and Part C (caching, perf, image/POI security) have merged to `main` (PRs #19, #20, #21). The remaining Phase 1 backlog does not require Apple Developer / live credentials. Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

## Active focus

- D1 Postgres pool tuning: set `max`, idle/connection timeouts, `on('error')`, and a graceful shutdown hook in `web/lib/db/postgres.ts`.
- Remaining Phase 1 backlog that can proceed without owner credentials:
  - D4: Fix Worker wrangler placeholders and add deploy docs.
  - D7: Add `checkin_likes` atomic toggle helper and `likes_count` sync (`web/lib/db/checkins.ts`).
  - A2: Harden sign-in/sign-out UX with loading/error states (`web/app/page.tsx`).
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
1. D1 — Tune Postgres pool config and error handling (`web/lib/db/postgres.ts`).
2. D4 — Fix Worker wrangler placeholders and add deploy docs.
3. D7 — Add `checkin_likes` table helper and atomic `likes_count` sync.
4. A2 — Harden sign-in/sign-out UX with loading/error states.
5. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   redirect URLs, Apple/Google provider config, self-hosted Postgres provision +
   schema (DATABASE_URL), Google OAuth, Apple Developer Program.
6. image-service deploy (§6): create R2 bucket + S3 API token, set R2_ACCOUNT_ID
   in wrangler.toml, set Worker secrets, deploy, wire IMAGE_SERVICE_URL/TOKEN.
7. poi-cache-service deploy (§7): Cloudflare D1/KV + secrets, apply D1 schema,
   deploy, wire POI_SERVICE_URL/TOKEN.
8. map-home — Apple MapKit full-screen map + custom markers  [BLOCKED on Apple Developer Program]
9. discovery-sheet — bottom sheet + swipe cards  [BLOCKED on map-home]
10. cafe-creation — first check-in flow  [BLOCKED on discovery-sheet; also needs auth-foundation round-trip + image-service deploy per pending-user-actions.md]
11. checkin-system — 0-100 sliders + policy chips  [BLOCKED on cafe-creation]
12. work-profile aggregation, search, navigation prompt  [BLOCKED on checkin-system]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- DATABASE_URL (self-hosted Postgres) not configured anywhere
- Postgres pool config not tuned (`max`, idle/connection timeouts, error handling, graceful shutdown)
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

A codebase review after merging Part C identified the remaining Phase 1 backlog items that are not blocked by owner credentials or Apple Developer: D1 (Postgres pool tuning), D4 (Worker wrangler placeholders/deploy docs), D7 (`checkin_likes` atomic toggle), and A2 (sign-in/sign-out UX hardening). D1 is the recommended next focus because it is foundational for database stability and does not require external accounts.
