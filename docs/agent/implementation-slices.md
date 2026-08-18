# Implementation Slices

Machine-checked implementation plan derived from `docs/specs/0001-nextjs-migration.md` phases. Each slice maps to required specs, dependencies, blockers, and test gates. Coding agents load one slice's context with `.agents/scripts/context-for-slice.sh <slice-id>` instead of reading every spec.

## Slice manifest

| ID | Title | Status | Specs | Dependencies | Active blockers | Test gates | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| scaffold-nextjs | Initialize Next.js workspace in web/ | COMPLETE | 0001, 0002 | none | none | typecheck, build | Next.js dev server and production build run in web/ |
| design-tokens | Design tokens, theme, dark mode | COMPLETE | 0002 | scaffold-nextjs | none | typecheck, build, visual | 2026 token set in globals.css, dark mode works |
| auth-foundation | Supabase OAuth + profiles + Postgres helpers | COMPLETE | 0001 | scaffold-nextjs | none | typecheck, unit, build | Supabase OAuth client + signIn/signOut actions, profile upsert, Postgres pg Pool; live provider config pending |
| map-home | Apple MapKit home map | BLOCKED | 0001, 0002 | scaffold-nextjs, design-tokens | Apple Developer Program account (MapKit JS token) | typecheck, build, e2e | Full-screen map, custom markers, clustering, dark scheme, geolocation |
| poi-cache-service | POI cache service (Workers + D1 + KV) | COMPLETE | 0001 | none | none | unit, deploy | Google/Apple POI resolve, cache, and distance search; Google Places key lives only in this service |
| places-proxy | Next.js /api/places/* route handlers proxying the POI service | COMPLETE | 0001 | poi-cache-service | none | typecheck, unit, build | Server-side POI client + search/resolve routes; Google key never in web/ |
| discovery-sheet | Bottom sheet + swipe cards + URL sync | BLOCKED | 0001, 0002 | map-home | none | typecheck, build, e2e | PEEK/HALF/FULL sheet with horizontal cards, back-button-safe URL sync |
| image-pipeline | Image upload pipeline (image-service Worker + sharp on VPS) | COMPLETE | 0001 | auth-foundation, scaffold-nextjs | none | typecheck, unit, build | Multi-size WebP upload, presigned R2 URLs, gallery JSONB, R2 metadata (uses Postgres helpers from auth-foundation; see ADR-0002) |
| cafe-creation | Creation flow = first check-in | BLOCKED | 0001, 0002 | auth-foundation, discovery-sheet, places-proxy, poi-cache-service, image-pipeline | none | typecheck, unit, build, e2e | Google Maps link import + map-tap creation, dedupe, creator check-in; populate `cafes.tz` from `location` (IANA lookup) so open-now works (issue #77) |
| checkin-system | Check-in drawer + sliders | BLOCKED | 0001, 0002 | cafe-creation | none | typecheck, unit, build, e2e | 0-100 sliders, policy chips with unknown, photos, repeat check-in flow |
| work-profile | Aggregation + dual scores | BLOCKED | 0001 | checkin-system | none | typecheck, unit, build | Incremental work_stats, experience + weighted scores, nightly recompute |
| search-filters | Hybrid search + nomad filters | BLOCKED | 0001, 0002 | discovery-sheet, poi-cache-service | none | typecheck, unit, build, e2e | Distance search over own cafes + saved POIs; external search persists POIs |
| navigation-prompt | Navigation tracking + return prompt | BLOCKED | 0001 | checkin-system | none | typecheck, unit, e2e | Navigation events recorded; ClassPass-style check-in prompt on return |
| profile-page | User profile page | BLOCKED | 0001, 0002 | auth-foundation, checkin-system | none | typecheck, build, e2e | /profile lists the user's check-ins |
| seo-sharing | SSR deep links + share flow | BLOCKED | 0001, 0002 | discovery-sheet | none | typecheck, build, e2e | /cafes/[id] SSR deep link, OG images, Web Share API |
| deploy-vps | Docker + VPS + CDN + CI/CD | BLOCKED | 0001, 0003 | work-profile, search-filters, navigation-prompt, seo-sharing | none | build, deploy | Production on VPS behind Cloudflare CDN with green pipeline |
| cleanup-legacy | Remove old Vite frontend + Java backend | BLOCKED | 0001 | deploy-vps | none | build, e2e | Legacy code removed after feature parity is verified |
| theme-preview-prototypes | Theme-preview prototypes and i18n expansion | COMPLETE | 0002, 0004 | design-tokens | none | typecheck, build, visual | ScoreSlider, PolicyChips, CheckInSuccessCard, ProfileSection, SearchFilter wired into /theme-preview with en/zh copy |
| auth-migration-stats | Auth middleware, schema migration, check-in types, work_stats aggregation | COMPLETE | 0001, 0004 | auth-foundation | none | typecheck, unit, build | `web/proxy.ts` refreshes sessions; `0002_checkins_and_indexes.sql` adds soft-delete, likes, indexes; `aggregate.ts` computes work_stats incrementally |
| cache-perf-security | Caching, performance, and image/POI security | COMPLETE | 0001, 0004 | auth-migration-stats, image-pipeline, places-proxy, design-tokens | none | typecheck, unit, build | Long-cache headers, tuned Serwist runtime cache, query persistence buster, 10 MB upload cap, maps URL validation, 10 km search cap, per-user rate limiting |
| phase1-remainder | Postgres pool tuning, Worker deploy docs, atomic like toggle, auth UX hardening | COMPLETE | 0001, 0004 | auth-foundation, cache-perf-security | none | typecheck, unit, build | Configurable Postgres pool with graceful shutdown, transaction helper, atomic `checkin_likes` toggle, documented Worker placeholders, loading/error sign-in UI |
| issue-23-rate-limit-backend | Postgres-backed distributed rate limiter | COMPLETE | 0001, 0003 | cache-perf-security, phase1-remainder | none | typecheck, unit, build | Rate buckets live in Postgres with atomic check + cleanup; `RATE_LIMIT_BACKEND` selects backend; CF-IP trust model documented (#54) |
| issue-24-likes-trigger | likes_count sync trigger + backfill migration | COMPLETE | 0001, 0003 | auth-migration-stats | none | typecheck, unit, build | Migration 0004 adds `checkin_likes` INSERT/DELETE triggers + backfill; counter cannot drift on cascade deletes (#57) |
| issue-25-complete-service | /api/images/complete split into lib service + atomic transaction | COMPLETE | 0001, 0003 | image-pipeline, phase1-remainder | none | typecheck, unit, build | Thin route controller; `web/lib/images/complete.ts` service; check-in + gallery writes in one transaction (#58) |
| issue-26-shared-common | Shared packages/common: types, UUID, auth, constants single-source | COMPLETE | 0001, 0003 | poi-cache-service, image-pipeline, places-proxy | none | typecheck, unit | Duplicated POI types / UUID validators / bearer auth / radius constants removed; web and both workers import one source (#53) |
| issue-27-stats-locking | work_stats read-modify-write under row lock | COMPLETE | 0001, 0003 | auth-migration-stats | none | typecheck, unit | `incrementalUpdateWorkStats` / `recomputeWorkStats` run inside `withTransaction` with `SELECT ... FOR UPDATE` (#56) |
| issue-75-i18n-guard | en/zh key parity check + next-intl typed messages | COMPLETE | 0003 | none | none | typecheck, unit, build | `web/scripts/check-i18n.mjs` + `check:i18n` wired into verify and CI; `AppConfig.Messages` augmentation makes bad `t()` keys fail typecheck |
| issue-76-visual-gate | Playwright rendered-page smoke gate in CI | COMPLETE | 0003 | none | none | typecheck, unit, build | `web/scripts/visual-smoke.mjs` + `check:visual` + `visual.yml`: 3 routes × light/dark × mobile/desktop, fails on console errors/non-2xx |
| issue-77-cafe-timezone | cafes.tz column + tz-correct open-now evaluation | COMPLETE | 0001 | none | none | typecheck, unit, build | Migration 0005 adds `cafes.tz` (IANA); `web/lib/hours.ts` `isOpenAt` evaluates weekly hours in cafe-local time; population deferred to cafe-creation slice |
| issue-45-domain-api-routes | Core domain API routes: cafes, check-ins, likes, navigations | COMPLETE | 0001 | auth-foundation | none | typecheck, unit, build | PR A (#83): cafes lib + routes (fused create + first check-in + tz, nearby list, detail). PR B (#84): checkins/likes/navigations routes + creation-flow gallery merge fix + recompute-not-fold stats (backdated visited_at). mapkit-token deferred (Apple creds) |
| issue-46-sw-api-cache | Service worker must not cache user-specific API GETs | COMPLETE | 0001 | none | none | typecheck, unit, build | Catch-all network-only `/api/` rule ahead of serwist defaultCache's 24h `apis` NetworkFirst (#85); ADR-0003 §3 amended to match |
| issue-33-upload-intents | Bind presigned image uploads to the issuing user | COMPLETE | 0001 | none | none | typecheck, unit, build | Migration 0006 `image_upload_intents`: record on upload, fail-fast pre-check + single-use consume inside complete's atomic tx; worker contract unchanged (#87) |
| issue-41-postgres-ssl | Postgres sslmode fail-closed + explicit allow-self-signed | COMPLETE | 0001 | auth-foundation | none | typecheck, unit, build | require/prefer/verify-* validate the CA chain; allow-self-signed opt-in; unknown/empty/wrong-case sslmode throws (#88) |
| issue-35-timing-safe-token | Constant-time token compare without length branch | COMPLETE | 0001 | issue-26-shared-common | none | typecheck, unit | `safeEqual` hashes both tokens (SHA-256) and compares fixed-length digests; async end-to-end, callers already await (#90) |
| issue-86-server-derived-photos | Server-derived StoredImage from photo_ids on create paths | COMPLETE | 0001 | issue-33-upload-intents | none | typecheck, unit, build | Clients send photo_ids; server checks intents, processes (sharp) outside tx, derives by/keys/w/h, consumes intents inside the creation tx (#91) |
| issue-39-hours-json | storeExternal hours_json must be parseable JSON | COMPLETE | 0001 | poi-cache-service | none | typecheck, unit | JSON.parse validation before write + zero-batch-calls regression guard; other #39 gaps landed earlier (#92) |
| issue-38-placeid-geo | Trust stored POI source over id-prefix heuristic; antimeridian-safe lng bbox | COMPLETE | 0001 | poi-cache-service | none | typecheck, unit | getPOI: KV probe any id, D1 row source authoritative, prefix heuristic last-resort only; d1SearchPOIs wraps lng interval across ±180° (haversine NaN clamp already on main) |
| issue-37-share-url-hosts | Maps share-URL host allowlist + redirect re-validation | COMPLETE | 0001 | poi-cache-service, places-proxy | none | typecheck, unit, build | Web validator: exact short/apple hosts + regional google.* pattern, https-only; worker resolveShareUrl: entry gate + per-hop https/host re-check, malformed Location no longer 500s |
| issue-40-r2-public-host | Single-source public image host + loader/runtime hygiene | COMPLETE | 0001 | image-pipeline | none | typecheck, unit, build | R2_PUBLIC_HOST stays the static single source (SW bundle can't read env — sentinel-verified); next.config asserts NEXT_PUBLIC_R2_PUBLIC_URL matches; loader gets "use client" + isR2Image path boundary; wildcard r2.cloudflarestorage.com remotePattern dropped |
| issue-36-checkins-indexes | Reconcile checkins indexes + checkin_likes constraint order with spec 0001 | COMPLETE | 0001 | auth-migration-stats | none | unit, build | Migration 0007: visited_at partial indexes (cafe/user/user_cafe) + idx_checkins_likes; unique (checkin_id, user_id) so the leading column serves count-by-checkin; query patterns verified against aggregate.ts. SQL-only change — no live Postgres available; validation rested on independent review + preflight, not the declared gates |
| issue-98-auth-error-feedback | Surface OAuth callback failure (?auth=error) on the home page | COMPLETE | 0001, 0002 | auth-foundation | none | typecheck, unit, build, visual | Inline danger banner above the sign-in card, reason=profile_upsert variant, en/zh copy, role=alert |
| issue-99-app-state-pages | Designed 404/error/loading states replace framework defaults | COMPLETE | 0002, 0003 | design-tokens | none | typecheck, unit, build, visual | not-found.tsx + error.tsx (client, Next 16 retry) + loading.tsx skeleton; /definitely-not-a-route back in the visual-smoke matrix with per-route expected status |
| issue-103-auth-error-codes | Auth action errors return stable codes mapped to i18n copy | COMPLETE | 0001, 0002 | auth-foundation | none | typecheck, unit, build | signIn/signOut return invalid_provider/not_configured/provider_start_failed/signout_failed; AuthErrorMessage maps codes to en/zh, raw provider strings go to server logs only |
| issue-107-no-self-like | Server-side no-self-like rule: authors cannot like their own check-ins | COMPLETE | 0001 | issue-45-domain-api-routes | none | typecheck, unit, build | TOGGLE_LIKE_SQL selects the check-in author and gates the insert on `<> $1`; toggleCheckInLike throws SelfLikeError, legacy self-like un-like still returns liked=false; route returns 403 self_like_forbidden; migration 0008 deletes pre-existing self-likes + BEFORE INSERT trigger for every writer; spec 0004 decision 8 records the rule (#107) |
| issue-117-integration-ci-gate | Enforce real-DB integration suite in CI | COMPLETE | 0003 | none | none | integration, preflight | `.github/workflows/integration.yml` starts pinned PostGIS and runs `npm run test:integration`; plain unit tests remain fast/skipped without Docker; required real-DB policy is now an actual CI gate (#117) |
| issue-118-integration-suite-safety | Harden real-DB suite safety and coverage | COMPLETE | 0003 | issue-117-integration-ci-gate | none | integration, preflight | Unique local test database, explicit host safety, fail-visible cleanup, order-independent cascade assertions, and non-empty photo/intent coverage (#118) |

## Status vocabulary

```text
READY       All dependencies COMPLETE, no active blockers — implementation permitted
BLOCKED     Waiting on dependencies or active blockers
IN-PROGRESS One writer actively implementing; finish before starting another slice
COMPLETE    Implemented and verified against the test gates
```

## Test gate vocabulary

```text
typecheck     tsc --noEmit (web, poi-service, image-service)
unit          Vitest unit/component tests (npm test)
integration   REAL-Postgres suite (npm run test:integration, RUN_INTEGRATION=1)
              — REQUIRED for slices touching web/db/migrations/*.sql, embedded
              SQL, or DB-backed lib flows; reasoning-only SQL validation never
              satisfies this gate
e2e           Playwright user-flow specs (post-MVP)
build         next build (production)
visual        rendered-page smoke gate (npm run check:visual) / screenshot review
deploy        wrangler deploy / VPS deploy steps verified
```

## Rules

```text
- Keep the table columns unchanged; harness scripts parse it.
- Do not implement through a slice's active blockers or incomplete dependencies.
- Do not infer unresolved product or design decisions.
- One production-code writer per slice.
- Implementation, testing, and review of one change share the same slice ID.
- Update this file when a slice status or blocker changes.
- New slices that touch the database (migrations, SQL, DB-backed flows) MUST
  declare the `integration` gate; user-visible UI slices declare `e2e` once
  Playwright is live.
- Enforcement note: the manifest validator (`implementation-slices.rb`) only
  checks that Test gates are non-empty — gate-vocabulary and
  must-declare-`integration` rules are enforced by the review layers
  (Layer-2 semantic review + code review), not by preflight.
```
