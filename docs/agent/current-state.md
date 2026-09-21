# Current State

## Phase

Implementation of owner-confirmed decisions from `docs/specs/0004-product-decisions-and-backlog.md` is in progress. Parts A–C and the remaining Phase 1 backlog (D1, D4, D7, A2) have merged to `main` (PRs #19, #20, #21, #22). Infrastructure slices (`image-pipeline`, `poi-cache-service`, `places-proxy`, `auth-foundation`) are code-complete but still pending owner credential/account actions.

The design-grill program is COMPLETE (2026-08-23): all seven map-independent UI artifacts were delivered and grilled (rounds 8–15, DG21–DG124), including the DG124 redesign that makes `/cafes/[id]` hydrate into the map app and abolishes the DeepLinkBanner. Every map-independent UI slice is design-unblocked; `discovery-sheet`, `seo-sharing`, `profile-page`, `search-filters`, and `checkin-system` are COMPLETE, the rest READY in `docs/agent/implementation-slices.md`; the map-bound artifacts were never delivered, but map-home (BRAWUKA-311) shipped on MapLibre GL + OpenFreeMap without them — the Apple credentials blocker (#131) no longer gates any map slice.

## Active focus

- Owner credential/account actions remain outstanding; both edge Workers
  (`poi-service`, `image-service`) are deployed to staging and production, so what
  is left there is the POI Google Places key, a Cloudflare deploy API token, and
  custom domains — see `docs/agent/pending-user-actions.md`.
- BRAWUKA-370/473 UI density program: the BRAWUKA-370 audit's four sub-issues
  (418/419/420/421) merged via #514/#516/#517; the follow-up density pass
  (BRAWUKA-473, PRs #518/#519) unified concentric radii, chip sizing, type pairing,
  44px hit areas, and skeleton geometry, and codified the rules in spec 0002
  §Spacing and radius. Design artifacts in `docs/design/` were harmonized to
  shipped code (see `docs/design/README.md` §Harmonization notes).
- BRAWUKA-335 spec revision (specs 0003/0005 + new 0010): local dev defaults to
  the staging Supabase project for auth (Google OAuth) while app data stays on
  the local compose Postgres; `supabase-mock` is retained for offline/unit use;
  staging journey suites run in per-suite scratch DBs via a serialized
  `staging-journey` workflow; prod promotion adds manual owner approval.
- BRAWUKA-475/476 nightly recompute migration: nightly work_stats recompute and Helpful ranking snapshot migrated from GitHub Actions (.github/workflows/nightly-recompute.yml deleted) to Dokploy VPS scheduled jobs (02:00 UTC daily) via deploy/dokploy/nightly-recompute.sh. Production DATABASE_URL stays confined to Dokploy environment variables without entering GitHub secrets. Failure alerting triggers Multica autopilot webhook (MULTICA_AUTOPILOT_WEBHOOK_URL).
- Open issues carry tier-0..3 labels mirroring the priority tiers in `docs/specs/0004` §Priority tiers (authority lives there, not in the harness). Fix order: tier-0 correctness/security/docs-truth first, then tier-1 launch gates.
- Issue #24's likes_count trigger (#57) and work_stats row locking (#56) are merged; #24 stays open (tier-0) until the gallery-merge convergence in #234 lands. JSONB normalization is deferred with a revisit trigger (0004 Post-MVP).
- Issue #114 established that Apple credentials do not block map-independent
  work. Design gates for those slices are now all cleared — every
  map-independent UI artifact is delivered and grilled (DG21–DG124); only the
  map-bound artifacts remain, waiting on Apple credentials (#131).

## What exists

```text
web/                     Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl (the app)
web/db/migrations/       0001_init.sql — core schema (spec 0001);
                         0002_checkins_and_indexes.sql, 0003_rate_limits.sql,
                         0004_checkin_likes_trigger.sql, 0005_cafe_timezone.sql,
                         0006_image_upload_intents.sql, 0007_checkins_spec_alignment.sql,
                         0008_no_self_likes.sql, 0009_cafe_tombstones.sql,
                         0010_drop_min_spend.sql (DG125), 0011_cafe_tombstone_lifecycle.sql,
                         0012_drop_redundant_cafe_indexes.sql,
                         0013_search_city_index.sql,
                         0014_fk_indexes_and_partial_gist.sql,
                         0015_drop_dead_cafe_columns.sql (#253),
                         0016_seed_service_account.sql (DG125/#229),
                         0017_cafe_visibility.sql (DG147/#229),
                         0018_public_identity.sql (#139),
                         0019_checkin_idempotency.sql (DG61),
                         0020_navigation_prompt_queue.sql (#149),
                         0021_helpful_ranking.sql (DG148),
                         0022_profiles_onboarded.sql (DG122),
                         0023_runtime_config.sql (BRAWUKA-284),
                         0024_service_account_rename.sql (BRAWUKA-278),
                         0025_drop_cafes_cover.sql (BRAWUKA-307),
                         0026_drop_rate_limits.sql (BRAWUKA-378),
                         0027_navigation_unresolved_dedupe.sql (BRAWUKA-391),
                         0028_open_now_sql_function.sql (DG145-C/BRAWUKA-25)
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
                         plus `provisionPhotos` photo provisioning with atomic DB writes
web/app/api/images/      upload route handler with per-user rate limiting
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
                         (10 km cap), GET [id] detail, DELETE [id] (creator-only soft
                         delete, 401/404/403), GET [id]/checkins public feed,
                         GET [id]/recovery (gone-cafe 404 suggestions, DG111)
web/app/cafes/[id]/      SSR public cafe shell + client-loaded feed (seo-sharing #150):
                         JSON-LD, canonical/hreflang, OG + dynamic fallback card,
                         gone-cafe 404; app/sitemap.ts + app/robots.ts + public/llms.txt
web/components/checkin/  Check-in drawer, sliders, photo uploader, and success feedback (PR #287)
web/lib/rate-limit.ts    In-memory token-bucket rate limiter with a shared client identifier helper
web/next.config.ts       Long immutable Cache-Control headers for static/PWA assets
web/app/sw.ts            Serwist runtime cache (CacheFirst for immutable assets, NetworkOnly for
                         dynamic pages and API routes)
web/shared/places/types.ts  POI types shared with the worker
docs/specs/              0001 Next.js rewrite, 0002 design system, 0003 testing/CI, 0005 Dokploy VPS deploy
docs/agent/              current state, planned-slice manifest, owner actions
.agents/                 Agent rules, workflows, skills, scripts, and review gates
```

## What's next

### Next unblocked work

```text
1. Owner actions (docs/agent/pending-user-actions.md §1–4): Supabase anon key +
   redirect URLs, Apple/Google provider config, Supabase Postgres provisioning +
   schema (DATABASE_URL, §2 / #142), Google OAuth, Apple Developer Program.
2. image-service residual (§6): both Workers are deployed; what remains is the
   `images.` / `staging-images.cafemood.app` custom domains once the zone is
   live, plus bucket defenses and orphan-cleanup scheduling.
3. poi-cache-service residual (§7): both environments are deployed and verified
   (2026-09-12) against their own D1/KV bindings; what remains is owner-side —
   install GOOGLE_PLACES_API_KEY (§5) and a Cloudflare deploy API token, then
   attach the custom domain once the zone is live.
4. Map-independent UI slices: helpful-ranking-snapshot (#140) is
   design-unblocked and READY. discovery-sheet (#133), checkin-system (#148),
   seo-sharing (#150), profile-page (#152, PR #209), search-filters (#135),
   navigation-prompt (#149), app-config (#189), and onboarding-geolocation
   (#153, PR #450) are COMPLETE — feature slices consume
   `web/lib/config.ts`, never hardcode. One writer per slice
```

### Map slices (map-home landed — BRAWUKA-311)

```text
- map-home — COMPLETE: MapLibre GL v5 + OpenFreeMap basemap on `/`; the
  Apple Developer blocker (#131) is eliminated — BRAWUKA-308's review
  pivoted the basemap to MapLibre. Tile host = the `map:` section in
  web/config/app.yaml; BRAWUKA-362 replaced the OFM liberty/dark styles
  with CoffeeMode's own two-ink vintage styles served same-origin from
  web/public/map/ (vector tiles + glyphs still on the public OFM instance;
  self-hosting permanently off the table per BRAWUKA-321 owner decision).
  The surface binds to `IMapProvider`, not MapLibre — a Google/Apple swap
  is a provider swap, not a rewrite.
  No MapKit fallback — the old implementation never shipped,
  there is nothing to fall back to.
- map-discovery-integration — PARTIAL: selection → flyTo, clustered pins,
  marker tap → URL sync landed with map-home; the map search overlay and
  external-result pins remain (#134).
- map-creation-entry — READY: map-tap creation + reverse geocoding
  (Nominatim/Photon picked at implementation time) (#136).
- deeplink-hydration — COMPLETE: /cafes/[id] SSR shell hydrates into the
  map app at FULL (DG124); /?cafe= 308s to the canonical URL (BRAWUKA-514).
```

### Blocked context (do not start yet)

```text
- deploy-vps — Docker + VPS + CDN + CI/CD [BLOCKED on domain + VPS + Cloudflare account]
```

## Known issues

```text
- NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only URL + service-role present locally)
- NEXT_PUBLIC_SITE_URL not set; NEXT_PUBLIC_ALLOWED_HOSTS not configured
- DATABASE_URL (Supabase main Postgres per 0004 decision 34a) not configured for production yet (#142; local dev uses `docker compose up -d --wait postgres` + `npm run db:migrate`, see `docs/agent/local-dev-stack.md`)
- Supabase dashboard still needs Apple/Google OAuth provider config
- Session-refresh proxy (`web/proxy.ts`) refreshes only when a Supabase session cookie is present; route handlers verify the session via `getUser()` before any Postgres write
- Postgres pool tuned with configurable `max`, idle/connection timeouts, error handling, and a graceful shutdown hook registered via Next.js `instrumentation.ts`
- Rate limiting enforces in memory on the single app container (BRAWUKA-378 deleted the Postgres backend outright — a future multi-instance deploy needs a new shared-store decision)
- `next build` warns about custom Cache-Control for `/_next/static/:path*` — intentional for production hashed chunks
- `/cafes/[id]` shell carries `s-maxage` (DG105); the bypass side is executable since BRAWUKA-184, not a comment: `seo.shellCache` in `web/config/app.yaml` owns TTLs + bypass values, `web/lib/cache-policy.ts` owns the predicates + edge-rule derivation, `web/proxy.ts` stamps `private, no-store` on session-refresh (Set-Cookie) responses and the gone-cafe 404 rewrite, and `deploy/dokploy/cache-rules.json` (drift-pinned by `tests/cafe-shell-cache.test.ts`) owns the edge rule — the future Cloudflare CDN (deploy-vps) must enforce it (vary on Accept-Language since Next strips origin Vary on App Router HTML; bypass on `sb-*` request cookies and Set-Cookie responses; only 200 cacheable). `sitemap.xml` is cached with the same `s-maxage` (DG105/DG107).
- `maps_share_url` host validation, 10 km nearby-search cap, and 10 MB image-upload cap are active
- Issue #158 adds the safe orphan-original cleanup: `image-service/scripts/clean-orphan-originals.mjs` (npm run clean:orphan-originals) deletes `original/` objects older than RETENTION_DAYS that lack completion metadata OR are still in the "provision" stage (uploaded but never attached) AND are absent from the `web/scripts/export-live-image-keys.mjs` DB export (BRAWUKA-400 reference-aware: referenced stale-marker keys report `would-keep reason:"referenced"`, never deleted). complete() now REQUIRES stage metadata: the creation flow sends provision + imageUuid (issue #86 pre-target processing); the post-commit attach leg (BRAWUKA-400) re-marks live originals to `checkin` via a metadata-preserving re-PUT, never blocking the committed creation. DRY_RUN=1 default, cursor-paginated, batch-bounded, idempotent, structured JSON output; covered by the images integration suite. Production schedule (export + sweep)/least-privilege creds remain owner actions (#147, #154).
- Apple Developer Program purchase pending (needed for MapKit JS and Apple live search only; #131)
- poi-service is deployed to both environments (its `poi-store`/`poi-cache` D1 + KV
  resources applied 2026-09-12) but still runs without `GOOGLE_PLACES_API_KEY`, so
  its Google-upstream routes answer 502 `upstream_error`; a Cloudflare deploy API
  token is owed too (pending-user-actions §5, §7). The wrangler.toml placeholder
  bindings remain the local-dev compose kit — image-service custom domains are
  likewise still owner actions (§6).
```
