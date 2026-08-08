# Current State

## Phase

Rewrite in progress. Harness + docs merged to `main` (PR #7). `web/` Next.js 16 workspace scaffolded (PR #8) and the design-token/theme layer landed (PR #9, Kimi-delegated, independently verified). Auth foundation code is complete; live OAuth round-trip is pending dashboard configuration. Image-pipeline slice is COMPLETE following ADR-0002.

## Active focus

Slice `image-pipeline` (COMPLETE — code complete, deploy pending): `image-service` Cloudflare Worker for presigned R2 upload URLs, Next.js `/api/images/upload` and `/api/images/complete` route handlers, and `sharp`-based resize to `original` (capped at 4096px) / `card` / `thumbnail` on the VPS.
`places-proxy` routes are COMPLETE; the upstream `poi-cache-service` Worker deploy (D1/KV/secrets + `POI_SERVICE_URL`/`POI_SERVICE_TOKEN`) is still pending (pending-user-actions.md §7).

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
coffeemode-frontend/     old Vite app — reference only, superseded
coffeemode_backend/      old Java app — being dropped
```

## What's next

```text
1. auth-foundation round-trip once credentials land (anon key, Postgres URL,
   Apple/Google provider config in Supabase dashboard) — code already merged
2. poi-cache-service worker deploy (Cloudflare account + D1/KV + secrets; pending-user-actions.md §7)
3. map-home — Apple MapKit full-screen map + custom markers  [BLOCKED on Apple Developer Program]
4. discovery-sheet — bottom sheet + swipe cards  [BLOCKED on map-home]
5. cafe-creation — first check-in flow  [BLOCKED on discovery-sheet; also needs auth-foundation round-trip + image-service deploy per pending-user-actions.md]
6. checkin-system — 0-100 sliders + policy chips  [BLOCKED on cafe-creation]
7. work-profile aggregation, search, navigation prompt  [BLOCKED on checkin-system]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- DATABASE_URL (self-hosted Postgres) not configured anywhere
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh middleware needed when first protected route lands (auth slice review F5)
- Apple Developer Program purchase pending (needed for MapKit JS)
- poi-service/wrangler.toml has placeholder KV/D1 ids; deploy blocked on
  Cloudflare account + secrets (pending-user-actions §7)
- image-service/wrangler.toml needs R2 bucket name and R2_ACCOUNT_ID in [vars]; IMAGE_SERVICE_TOKEN, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set via wrangler secret put
```
