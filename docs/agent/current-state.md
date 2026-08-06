# Current State

## Phase

Rewrite in progress. Harness + docs merged to `main` (PR #7). `web/` Next.js 16 workspace scaffolded (PR #8) and the design-token/theme layer landed (PR #9, Kimi-delegated, independently verified). Auth foundation slice in progress.

## Active focus

Slice `places-proxy` (IN-PROGRESS): server-side POI client + `/api/places/search` + `/api/places/resolve` route handlers proxying the POI cache service (merged as PR #11, slice now COMPLETE). Upstream worker not deployed yet — tests mock it; live calls return 503 until `POI_SERVICE_URL`/`POI_SERVICE_TOKEN` are set (pending-user-actions §6).

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — 4-table schema (spec 0001)
web/lib/auth/            Supabase server client (PKCE), profile upsert logic
web/lib/db/              Neon pool (server-side only)
web/app/auth/            signIn/signOut server actions + OAuth callback route
poi-service/             POI cache microservice (Workers + D1 + KV) — 4 endpoints,
                         Google field masks, KV hot cache, D1 store, haversine search
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
1. auth-foundation round-trip once credentials land (anon key, Neon URL,
   Apple/Google provider config in Supabase dashboard)
2. places-proxy: review + merge PR #12; worker deploy unblocks live POI calls
3. map-home — Apple MapKit full-screen map + custom markers  [BLOCKED on Apple Developer Program]
4. discovery-sheet, image-pipeline, cafe-creation, checkin-system
5. work-profile aggregation, search, navigation prompt
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- DATABASE_URL (Neon) not configured anywhere
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh middleware needed when first protected route lands (auth slice review F5)
- Apple Developer Program purchase pending (needed for MapKit JS)
- poi-service/wrangler.toml has placeholder KV/D1 ids; deploy blocked on
  Cloudflare account + secrets (pending-user-actions §6)
```