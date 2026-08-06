# Current State

## Phase

Rewrite in progress. Harness + docs merged to `main` (PR #7). `web/` Next.js 16 workspace scaffolded (PR #8) and the design-token/theme layer landed (PR #9, Kimi-delegated, independently verified). Auth foundation slice in progress.

## Active focus

All code-side infrastructure through the POI stack is merged and COMPLETE: `poi-cache-service` (PR #11) and `places-proxy` (PR #12). Remaining slices are blocked on owner credential/account actions (see `docs/agent/pending-user-actions.md`): `auth-foundation` round-trip needs Supabase anon key + Neon URL + provider config; `map-home` needs the Apple Developer Program purchase.

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
1. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   provider config, Neon project + schema, Google OAuth, Apple Developer Program
2. poi-cache-service deploy (§5–6): Google Places key, Cloudflare D1/KV + secrets
3. Unblocks then: auth-foundation round-trip → cafe-creation / checkin-system /
   discovery-sheet (map-home after Apple) → work-profile, search, navigation
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