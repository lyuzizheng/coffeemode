# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Part A (design tokens, i18n, theme-preview prototypes) has merged to `main` (PR #19). Part B (auth proxy, schema migration, check-in/profile types, `work_stats` aggregation) is on PR #20. Part C (caching, perf, image/POI security) is the next batch. Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

## Active focus

- Part B review/merge: `feat/impl-auth-middleware` (PR #20) — `web/proxy.ts` session refresh, `web/db/migrations/0002_checkins_and_indexes.sql`, `web/types/checkins.ts` / `profile.ts`, and `web/lib/stats/aggregate.ts`.
- Part C implementation (no Apple Developer / map dependency):
  - Long cache headers for static/PWA assets in `web/next.config.ts` (C1).
  - Serwist runtime cache tuning in `web/app/sw.ts` (C2).
  - Query-persistence buster and restore-error handler (C3).
  - Image upload size cap and R2 lifecycle guidance (D3).
  - `maps_share_url` domain validation in `/api/places/resolve` (D5).
  - Nearby search 10 km cap and rate-limit placeholders for image/POI routes (D6).
- Owner credential/account actions remain outstanding and are tracked in `docs/agent/pending-user-actions.md`.

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — 4-table schema (spec 0001)
web/lib/auth/            Supabase server client (PKCE), profile upsert logic
web/lib/db/              Postgres pool (server-side only)
web/app/auth/            signIn/signOut server actions + OAuth callback route
web/lib/images/          image-service client + sharp processor
web/app/api/images/      upload + complete route handlers
poi-service/             POI cache microservice (Workers + D1 + KV) — 4 endpoints,
                         Google field masks, KV hot cache, D1 store, haversine search
image-service/           Image upload microservice (Cloudflare Worker + R2 presigned URLs)
web/lib/places/          Server-only POI service client (search/resolve/get)
web/app/api/places/      search + resolve route handlers proxying the POI service
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
- Apple Developer Program purchase pending (needed for MapKit JS)
- poi-service/wrangler.toml has placeholder KV/D1 ids; deploy blocked on
  Cloudflare account + secrets (pending-user-actions §7)
- image-service/wrangler.toml needs R2 bucket name and R2_ACCOUNT_ID in [vars]; IMAGE_SERVICE_TOKEN, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set via wrangler secret put
```

## Latest review

A batched subagent review (frontend/UX, check-in/social, cafe creation/discovery, auth/cache/perf/DB/deploy) produced `docs/specs/0004-product-decisions-and-backlog.md`. It contains proposed product decisions, an implementation backlog split into four phases, and open questions that need owner confirmation before they become canonical.
