# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Parts A–C and the remaining Phase 1 backlog (D1, D4, D7, A2) have merged to `main` (PRs #19, #20, #21, #22). Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

The design-grill program is COMPLETE (2026-08-23): all seven map-independent UI artifacts were delivered and grilled (rounds 8–15, DG21–DG124), including the DG124 redesign that makes `/cafes/[id]` hydrate into the map app and abolishes the DeepLinkBanner. Every map-independent UI slice is now design-unblocked and READY in `docs/agent/implementation-slices.md`; the remaining design debt is the three map-bound artifacts, which wait on Apple credentials (#131) anyway.

## Active focus

- Owner credential/account actions and worker deploys remain outstanding; see `docs/agent/pending-user-actions.md`.
- Issue #23 (distributed Postgres token-bucket rate limiter) is merged.
- Issue #25 (image completion service with atomic DB writes) is merged.
- Issue #24's likes_count trigger is merged (#57); #24 stays open for JSONB normalization.
- Issue #26 (shared packages/common single-source) is merged.
- Issue #27 (work_stats row locking) is merged (#56).
- Issue #74 merges the post-review P1 fixes for PRs #66–#73 (OAuth redirect allowlist, proxy session refresh, profile upsert failure, sign-out cache clearing, and upstream POI/image error logging).
- Issue #114 established that Apple credentials do not block map-independent
  work. Design gates for those slices are now all cleared — every
  map-independent UI artifact is delivered and grilled (DG21–DG124); only the
  map-bound artifacts remain, waiting on Apple credentials (#131).
- Issue #117 adds CI enforcement for the real-DB integration suite; the local suite is green.
- Issue #118 hardens the real-DB suite against unsafe database targets and order-dependent coverage.
- Issue #119 preserves image-service storage failures instead of mapping them to `not_found`.
- Issue #156 adds a real MinIO/R2 image round-trip suite (`web/tests/integration/images.integration.test.ts`, `npm run test:integration:images`): presigned PUT -> HEAD -> processor variant re-upload, `completeImageUpload` end-to-end with real storage + DB gallery/intent metadata + replay rejection, missing-object 404, tampered Content-Type 403, single-use intent consume, and bad-creds 403. Storage failures fail the suite (no silent skip); CI runs it in `images-integration-gate`.
- Issue #130 / PR #128 shipped the `cafe-creation` slice: Google/Apple Maps link import and Google/Apple provider search share one first-check-in flow. PR #128 merged 2026-08-20; the Kimi visual review was completed post-merge on 2026-08-23 (verdict on PR #128); findings #183–#185 were fixed in PR #187. Slice is COMPLETE.
- PR #138 (docs: cafe-creation spec and map backlog) is merged to `main`.
- Issue #146 / work-profile slice completes the map-independent work_stats aggregation: `coerceWorkStats` preserves `experience_score`/`composite_score`, create/edit/soft-delete recompute via `recomputeWorkStats` with `FOR UPDATE`, public-safe `CafeSummary`/`CafeDetail` expose both scores, `web/scripts/recompute-work-stats.mjs` provides the idempotent nightly drift correction and `.github/workflows/nightly-recompute.yml` schedules it at 02:00 UTC with observable failure.
- Issue #189 / app-config slice adds the universal typed config: `web/config/rate-limits.yaml` owns the 4 API rate-limit buckets, `web/config/app.yaml` owns product parameters (`search.maxRadiusKm`, `cafes.listLimitMax`), and `web/lib/config.ts` loads + schema-validates both at startup (fail-fast on bad shape). Existing call sites migrated with values unchanged; feature slices must consume config, never hardcode.
- Apple live search is configuration-gated and does not block link import or Google search. New user-visible UI implementation is separately design-gated on a slice-specific Kimi K3 artifact.

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
poi-service/             POI cache microservice (Workers + D1 + KV) — stored search,
                         live Google search, resolve, and external-result persistence;
                         Google field masks, KV hot cache, D1 store, haversine search
image-service/           Image upload microservice (Cloudflare Worker + R2 presigned URLs,
                         10 MB cap, lifecycle guidance)
web/lib/places/          Server-only POI service client (stored/live search, resolve,
                         external persistence, get) + maps URL validator
web/app/api/places/      search + resolve + external-result route handlers with rate limiting,
                         10 km radius cap, and maps URL domain validation
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
4. Map-independent UI slices are all design-unblocked and READY — pick any of:
   discovery-sheet (#133), search-filters (#135), checkin-system (#148),
   navigation-prompt (#149), profile-page (#152), seo-sharing (#150),
   onboarding-geolocation (#153). app-config (#189) is COMPLETE — feature
   slices consume `web/lib/config.ts`, never hardcode. One writer per slice
```

### Blocked context (do not start yet)

```text
- map-home — Apple MapKit full-screen map + custom markers [BLOCKED on Apple Developer Program; #131, #132; map-home design artifact still owed]
- map-discovery-integration — bind discovery/search to MapKit [BLOCKED on map-home; #134]
- map-creation-entry — map-tap and map-surface creation entry [BLOCKED on map-home; #136]
- deeplink-hydration — /cafes/[id] SSR shell hydrates into the map app at FULL (DG124) [BLOCKED on discovery-sheet + Apple MapKit creds #131; part of #150]
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
- Issue #158 adds the safe orphan-original cleanup: `image-service/scripts/clean-orphan-originals.mjs` (npm run clean:orphan-originals) deletes `original/` objects older than RETENTION_DAYS that lack completion metadata OR are still in the "provision" stage (uploaded but never attached). complete() now REQUIRES stage metadata: the attach flow sends cafe|checkin + target id; the creation flow sends provision + imageUuid (issue #86 pre-target processing). DRY_RUN=1 default, cursor-paginated, batch-bounded, idempotent, structured JSON output; covered by the images integration suite. Production schedule/least-privilege creds remain owner actions (#147, #154).
- Apple Developer Program purchase pending (needed for MapKit JS and Apple live search only; #131)
- poi-service/wrangler.toml and image-service/wrangler.toml placeholders are
  documented; deploy blocked on Cloudflare account + secrets (pending-user-actions §6–7)
```

## Latest review

D1, D4, D7, and A2 were implemented together on `feat/impl-phase1-remainder`. An independent review surfaced four blockers: the like CTE could insert orphaned rows for soft-deleted check-ins, the pool shutdown hook auto-registered at import and force-exited the process, Worker `compatibility_date` values were in the future, and the image completion route wrote `StoredImage` records without a `source` attribution. All four were fixed and verified; the branch merged to `main` as PR #22.

An independent critical review of merged PRs #66–#73 surfaced P1 findings in OAuth `redirectTo` allowlist handling (#29), proxy session refresh (#30), OAuth callback profile upsert failure (#42), sign-out cache clearing (#47), and upstream POI/image error body logging (#50). The fixes were applied on `fix/post-review-p1-issues`, verified by `npm run verify` and `preflight`, and merged to `main` as PR #74.
