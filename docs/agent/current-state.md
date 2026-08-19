# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Parts A–C and the remaining Phase 1 backlog (D1, D4, D7, A2) have merged to `main` (PRs #19, #20, #21, #22). Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

## Active focus

- Owner credential/account actions and worker deploys remain outstanding; see `docs/agent/pending-user-actions.md`.
- Issue #23 (distributed Postgres token-bucket rate limiter) is merged.
- Issue #25 (image completion service with atomic DB writes) is merged.
- Issue #24's likes_count trigger is merged (#57); #24 stays open for JSONB normalization.
- Issue #26 (shared packages/common single-source) is merged.
- Issue #27 (work_stats row locking) is merged (#56).
- Issue #74 merges the post-review P1 fixes for PRs #66–#73 (OAuth redirect allowlist, proxy session refresh, profile upsert failure, sign-out cache clearing, and upstream POI/image error logging).
- Issue #114 tracks the corrected parallel development plan: MapKit-specific work remains blocked on the Apple Developer Program, while map-independent feature slices can proceed with APIs or fixtures.
- Issue #117 adds CI enforcement for the real-DB integration suite; the local suite is green.
- Issue #118 hardens the real-DB suite against unsafe database targets and order-dependent coverage.
- Issue #119 preserves image-service storage failures instead of mapping them to `not_found`.
- Real MinIO/R2 upload -> HEAD -> complete coverage remains a separate follow-up; the current integration gate is Postgres-only.
- `map-home` is the next blocked MapKit feature; non-map feature tracks are unblocked and can proceed in parallel.

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — 4-table schema (spec 0001);
                         0002_checkins_and_indexes.sql, 0003_rate_limits.sql,
                         0004_checkin_likes_trigger.sql, 0005_cafe_timezone.sql,
                         0006_image_upload_intents.sql, 0007_checkins_spec_alignment.sql,
                         0008_no_self_likes.sql
web/lib/auth/            Supabase server client (PKCE), profile upsert logic
web/lib/db/              Postgres pool (server-side only), withTransaction, atomic like toggle,
                         cafes domain lib (fused create + first check-in + stats, nearby list, getCafe),
                         checkins/navigations libs, image upload intents (issue #33)
web/lib/hours.ts         Open-now evaluation in the cafe's IANA timezone (isOpenAt)
web/lib/stats/           Recency-weighted `work_stats` aggregation with `incrementalUpdateWorkStats`
                         and `recomputeWorkStats`; concurrent writes serialize via `FOR UPDATE`
web/shared/              Shared primitives: UUID, auth helpers, places types/constants, image constants/validation
web/app/auth/            signIn/signOut server actions, SignInButton/SignOutButton client components + OAuth callback route
web/lib/images/          image-service client + sharp processor + 10 MB upload size propagation,
                         plus the `completeImageUpload` service with atomic DB writes
web/app/api/images/      upload + complete route handlers with per-user rate limiting
poi-service/             POI cache microservice (Workers + D1 + KV) — 4 endpoints,
                         Google field masks, KV hot cache, D1 store, haversine search
image-service/           Image upload microservice (Cloudflare Worker + R2 presigned URLs,
                         10 MB cap, lifecycle guidance)
web/lib/places/          Server-only POI service client (search/resolve/get) + maps URL validator
web/app/api/places/      search + resolve route handlers with rate limiting, 10 km radius cap,
                         and maps URL domain validation
web/app/api/cafes/       POST (fused create + first check-in, 409 dedupe), GET nearby list
                         (10 km cap), GET [id] detail
web/lib/rate-limit.ts    Token-bucket rate limiter: in-memory (dev/tests) or Postgres-backed
                         (production/horizontal scale) with a shared client identifier helper
web/next.config.ts       Long immutable Cache-Control headers for static/PWA assets
web/app/sw.ts            Serwist runtime cache (CacheFirst for immutable assets, NetworkOnly for
                         dynamic pages and API routes)
web/shared/places/types.ts  POI types shared with the worker
docs/specs/              0001 Next.js rewrite, 0002 design system, 0003 testing/CI
docs/agent/              current state, planned-slice manifest, owner actions
.agents/                 Agent rules, workflows, skills, scripts, and review gates
_archive-coffeemode-frontend/  old Vite app — reference only, superseded
_archive-coffeemode-backend/   old Java app — being dropped
```

## What's next

### Next unblocked work

```text
1. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   redirect URLs, Apple/Google provider config, self-hosted Postgres provision +
   schema (DATABASE_URL), Google OAuth, Apple Developer Program.
2. image-service deploy (§6): create R2 bucket + S3 API token, set wrangler.toml
   placeholders, set Worker secrets, deploy, wire IMAGE_SERVICE_URL/TOKEN.
3. poi-cache-service deploy (§7): Cloudflare D1/KV + secrets, apply D1 schema,
   deploy, wire POI_SERVICE_URL/TOKEN.
4. discovery-sheet — bottom sheet + swipe cards
5. cafe-creation — first check-in flow (manual name/address fallback; geocoding approach TBD, not MapKit-dependent)
6. checkin-system — 0-100 sliders + policy chips
7. work-profile aggregation, search, navigation prompt
8. profile-page — user profile and saved cafes
9. search-filters — hybrid search + nomad filters
10. seo-sharing — SSR deep links + share flow
```

### Blocked context (do not start yet)

```text
- map-home — Apple MapKit full-screen map + custom markers [BLOCKED on Apple Developer Program]
- map-discovery-integration — map-tap bottom sheet [BLOCKED on map-home]
- map-creation-entry — map-tap cafe creation [BLOCKED on map-home]
- deploy-vps — Docker + VPS + CDN + CI/CD [BLOCKED on domain + VPS + Cloudflare account]
- cleanup-legacy — remove old Vite frontend + Java backend [BLOCKED on deploy-vps]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- NEXT_PUBLIC_SITE_URL not set; NEXT_PUBLIC_ALLOWED_HOSTS not configured
- DATABASE_URL (self-hosted Postgres) not configured for production anywhere (local dev uses `docker compose up -d --wait postgres` + `npm run db:migrate`, see `docs/agent/local-dev-stack.md`)
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh proxy (`web/proxy.ts`) refreshes only when a Supabase session cookie is present; route handlers verify the session via `getUser()` before any Postgres write
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

An independent critical review of merged PRs #66–#73 surfaced P1 findings in OAuth `redirectTo` allowlist handling (#29), proxy session refresh (#30), OAuth callback profile upsert failure (#42), sign-out cache clearing (#47), and upstream POI/image error body logging (#50). The fixes were applied on `fix/post-review-p1-issues`, verified by `npm run verify` and `preflight`, and merged to `main` as PR #74.
