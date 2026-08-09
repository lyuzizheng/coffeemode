# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Parts A–C and the remaining Phase 1 backlog (D1, D4, D7, A2) have merged to `main` (PRs #19, #20, #21, #22). Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

## Active focus

- Owner credential/account actions and worker deploys remain outstanding; see `docs/agent/pending-user-actions.md`.
- Issue #23 (distributed Postgres token-bucket rate limiter) is implemented and pending review/merge.
- Next unblocked feature work is `map-home` (Apple MapKit full-screen map), which is blocked on the Apple Developer Program.

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — 4-table schema (spec 0001)
web/lib/auth/            Supabase server client (PKCE), profile upsert logic
web/lib/db/              Postgres pool (server-side only), withTransaction, atomic like toggle
web/shared/              Shared primitives: UUID, auth helpers, places types/constants, image constants/validation
web/app/auth/            signIn/signOut server actions, SignInButton/SignOutButton client components + OAuth callback route
web/lib/images/          image-service client + sharp processor + 10 MB upload size propagation
web/app/api/images/      upload + complete route handlers with per-user rate limiting
poi-service/             POI cache microservice (Workers + D1 + KV) — 4 endpoints,
                         Google field masks, KV hot cache, D1 store, haversine search
image-service/           Image upload microservice (Cloudflare Worker + R2 presigned URLs,
                         10 MB cap, lifecycle guidance)
web/lib/places/          Server-only POI service client (search/resolve/get) + maps URL validator
web/app/api/places/      search + resolve route handlers with rate limiting, 10 km radius cap,
                         and maps URL domain validation
web/lib/rate-limit.ts    Token-bucket rate limiter: in-memory (dev/tests) or Postgres-backed
                         (production/horizontal scale) with a shared client identifier helper
web/next.config.ts       Long immutable Cache-Control headers for static/PWA assets
web/app/sw.ts            Serwist runtime cache (CacheFirst for immutable assets, NetworkOnly for
                         dynamic pages and API routes)
web/shared/places/types.ts  POI types shared with the worker
docs/specs/              0001 Next.js rewrite, 0002 design system, 0003 testing/CI
docs/agent/              slices manifest (machine-checked), this file, protocols
.agents/                 Agent workflows, scripts, delegated design prompts
_archive-coffeemode-frontend/  old Vite app — reference only, superseded
_archive-coffeemode-backend/   old Java app — being dropped
```

## What's next

```text
1. Independent review and merge of `feat/impl-phase1-remainder` (D1/D4/D7/A2).
2. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   redirect URLs, Apple/Google provider config, self-hosted Postgres provision +
   schema (DATABASE_URL), Google OAuth, Apple Developer Program.
3. image-service deploy (§6): create R2 bucket + S3 API token, set wrangler.toml
   placeholders, set Worker secrets, deploy, wire IMAGE_SERVICE_URL/TOKEN.
4. poi-cache-service deploy (§7): Cloudflare D1/KV + secrets, apply D1 schema,
   deploy, wire POI_SERVICE_URL/TOKEN.
5. map-home — Apple MapKit full-screen map + custom markers  [BLOCKED on Apple Developer Program]
6. discovery-sheet — bottom sheet + swipe cards  [BLOCKED on map-home]
7. cafe-creation — first check-in flow  [BLOCKED on discovery-sheet; also needs auth-foundation round-trip + image-service deploy per pending-user-actions.md]
8. checkin-system — 0-100 sliders + policy chips  [BLOCKED on cafe-creation]
9. work-profile aggregation, search, navigation prompt  [BLOCKED on checkin-system]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- DATABASE_URL (self-hosted Postgres) not configured anywhere
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh proxy implemented (`web/proxy.ts`); first protected route can now rely on it
- Postgres pool tuned with configurable `max`, idle/connection timeouts, error handling, and a graceful shutdown hook registered via Next.js `instrumentation.ts`
- Postgres-backed rate limiter is ready for production; `RATE_LIMIT_BACKEND` environment variable selects backend
- `next build` warns about custom Cache-Control for `/_next/static/:path*` — intentional for production hashed chunks
- `maps_share_url` host validation, 10 km nearby-search cap, and 10 MB image-upload cap are active
- R2 lifecycle cleanup for abandoned `original/` objects requires a scheduled Worker/script (metadata rules cannot filter)
- Apple Developer Program purchase pending (needed for MapKit JS)
- poi-service/wrangler.toml and image-service/wrangler.toml placeholders are
  documented; deploy blocked on Cloudflare account + secrets (pending-user-actions §6–7)
```

## Latest review

D1, D4, D7, and A2 were implemented together on `feat/impl-phase1-remainder`. An independent review surfaced four blockers: the like CTE could insert orphaned rows for soft-deleted check-ins, the pool shutdown hook auto-registered at import and force-exited the process, Worker `compatibility_date` values were in the future, and the image completion route wrote `StoredImage` records without a `source` attribution. All four were fixed and verified; the branch merged to `main` as PR #22.
