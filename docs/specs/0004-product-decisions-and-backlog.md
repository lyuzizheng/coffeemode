# 0004. Product Decisions and Backlog

## Goal

Capture the output of the batched subagent review covering frontend/UX design, check-in & social semantics, cafe creation & discovery, and auth/cache/perf/DB/deploy. This spec records **owner-confirmed** product and engineering decisions, surfaces the decisions that still need an owner call, and lines up the resulting implementation backlog by phase.

## Status

Confirmed — owner replied to the open questions on 2026-08-08. Unanswered items defaulted to the original recommendation. The decisions here should still be merged into canonical specs `0001` and `0002` (and the implementation-slices manifest) as implementation begins.

## Review scope

Four read-only subagent reviews ran in parallel against the current `main` tree (post-PWA code-quality cleanup):

1. **Frontend/UX design** — design-system consistency, `/profile`, check-in success card, creation flow.
2. **Check-in & social semantics** — "every review is a check-in", likes/favorites, scoring weight, profile records.
3. **Cafe creation & discovery** — entry methods (Google Maps import, map-tap, search, manual), edge cases, POI service gaps.
4. **Auth/cache/perf/DB/deploy** — session middleware, caching, performance, database indexes, deploy pipeline.

## Stable decisions

### Design system

1. **HeroUI v3 is the canonical component library.** Remove the stale Shadcn directive in `.windsurf/rules/project-rule.md` so future agents do not introduce a second visual language.
2. **Add a real `--secondary` sage brand token.** Reconcile `docs/specs/0002-design-system.md` and `web/app/globals.css` so the palette is primary terracotta + secondary sage + status colors. Start with the original 0002 sage value `oklch(45.0% 0.080 155)` and adjust for contrast if needed.
3. **Use a small radius scale.** Codify `--radius-sm/md/lg/xl` in `globals.css` as small as practical for a dense mobile UI. Initial values: `2px / 4px / 6px / 8px`. `.card` uses `--radius-md` (4px).
4. **Shadow tokens must match spec or the spec must be updated.** Keep the warm espresso tint. Because `globals.css` already embodies the warm espresso shadows, update `docs/specs/0002-design-system.md` to match `globals.css`.
5. **In-app type scale ceiling is `text-2xl` (2rem).** Sandbox `theme-preview` hero sizes; page titles and cafe names use `font-display` inside the fixed scale.
6. **Mount `<Toast.Provider>` in `web/app/providers.tsx`.** HeroUI toast is the canonical success/error surface.

### Check-in & social semantics

7. **"Every review is a check-in" stays literal.** No separate `reviews` table in MVP. A `checkins` row carries scores, policies, note, and photos.
8. **Likes affect comment sorting and预留 scoring weight design space.** A `checkin_likes` table (unique `user_id` + `checkin_id`) is included in the MVP schema. The check-in note list is sorted by a hot-rank that mixes likes and recency. `work_stats` scoring keeps the slider-only signal by default (`social_weight = 0`) but exposes a tunable hook so likes can influence the composite weight later without a schema migration.
9. **Check-in `note` is a one-off review snippet.** Threaded replies are post-MVP.
10. **`/profile` shows both "My Cafes" and "My Check-ins".** "My Cafes" = distinct cafes the user has checked into at least once (derived from `checkins`), ordered by latest visit. Because creation is the first check-in, every cafe created by the user appears here. A "created by me" badge is shown where `is_creation=true`. "My Check-ins" = all check-in rows for the user, newest `visited_at` first.
11. **Browsing/view history is out of MVP scope.** If needed, use lightweight client-side recent views; server-side history is post-MVP.
12. **Check-ins support edit and soft delete.** Add `updated_at` and `deleted_at` to `checkins`. Delete sets `deleted_at` and recomputes `work_stats` from remaining non-deleted rows for that user.
13. **Photos from a deleted check-in are hidden from `cafes.gallery`.** Extend `StoredImage` with a `source` field (`{ type: "checkin", id }`) so the gallery query can filter out images whose source check-in is soft-deleted.

### Cafe creation & discovery

14. **Creation is the first check-in.** `POST /api/cafes` creates the cafe and a `checkins` row with `is_creation=true` in one transaction.
15. **Dedupe is mandatory.** Check `google_place_id` / `apple_poi_id` before insert. If a match exists, return `409` with the existing cafe and a "Check in here" prompt.
16. **MVP creation entry methods:** Google Maps link import, Apple Maps link import, and a manual fallback form. MapKit map-tap and search-result selection come after `map-home`.
17. **Cross-source (Google ↔ Apple) duplicate resolution is undefined and post-MVP.** Physical location dedupe is intentionally not solved for MVP.
18. **Offline creation is disabled in MVP.** Show the offline banner and disable the creation CTA. No mutation queue.

### Search & filters

19. **Nearby search radius is 10 km.** `GET /api/cafes?lat=&lng=&r=` defaults to and caps at 10 km.
20. **Free-text / city search is not geo-radius search.** It filters by city (or current city if omitted) and supports nomad-style filters: min `wifi/outlets/seats/temp/coffee/overall` score thresholds, `min_spend`, `max_stay`, `open_now`, plus future policy filters.
21. **Search filter UX is a first-class design task.** The filter surface must be thumb-friendly, clearly distinct from the map, and not a long modal form. Design in `theme-preview` before building.

### Auth/cache/perf/DB/deploy

22. **Session-refresh middleware is required.** Create `web/middleware.ts` using `@supabase/ssr` to refresh tokens on each request.
23. **Static and PWA assets get long immutable cache headers in `next.config.ts`.** Apply to `/_next/static/*`, `/icons/*`, `/fonts/*`.
24. **Serwist runtime cache must be tuned.** `/_next/static/*` → `CacheFirst` 1-year; dynamic routes (`/cafes/*`, `/profile`) → `NetworkOnly`.
25. **Postgres pool needs config and error handling.** Set `max`, idle/connection timeouts, `on('error')`, and a graceful shutdown hook.
26. **Add missing indexes:** `idx_cafes_created_by`, GIN on `cafes.gallery` and `checkins.photos` for `@>` containment, `idx_checkins_user (user_id, visited_at desc)`, `idx_cafes_apple_poi_id`, `idx_profiles_current_city`, GIN or B-tree on `checkins.deleted_at` for soft-delete filtering.
27. **`work_stats` incremental aggregation must be implemented** per `0001:236-258` with a nightly full-recompute fallback. Soft-deleted check-ins are excluded.
28. **Image upload needs a size cap and R2 lifecycle rule.** Cap at 10 MB in presigned PUT conditions; document lifecycle for abandoned `original/` objects.
29. **VPS deploy needs a Dockerfile and GitHub workflow** before public beta.
30. **Worker deploy placeholders must be fixed and documented** (`R2_ACCOUNT_ID`, D1/KV IDs, secrets).
31. **Add DB migration runner to CI** (dry-run on PR, apply on release).
32. **Validate `maps_share_url` domain in `/api/places/resolve`** before proxying.
33. **Image and POI routes need rate limiting.** Upload, complete, and POI resolve/search should be per-user rate-limited.

## Data/API/UI behavior

This section is the implementation backlog. Tasks are grouped by phase.

### Phase 1 — now (no Apple Developer / map dependency)

These tasks can proceed while `map-home` is blocked and before live credentials are configured. Use mocked data for UI prototypes where needed.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| F1 | Reconcile design tokens: add `--secondary` sage, codify small radius scale, align shadows, remove stale Shadcn rule | design | `.windsurf/rules/project-rule.md`, `web/app/globals.css`, `docs/specs/0002-design-system.md` |
| F2 | Mount `<Toast.Provider>` and wire auth success/error states | frontend | `web/app/providers.tsx`, `web/app/page.tsx`, `web/app/auth/actions.ts` |
| F3 | Build static UI prototypes in `theme-preview`: `ScoreSlider`, `PolicyChips`, `CheckInSuccessCard`, `ProfileHeader`, `SearchFilter` | design | `web/app/theme-preview/sections/*` |
| F4 | Add i18n namespaces: `profile`, `create`, `checkIn`, `success`, `search` | i18n | `web/messages/en.json`, `web/messages/zh.json` |
| S1 | Add `checkins.updated_at`, `checkins.deleted_at`, `checkin_likes` table, image `source` field, and missing indexes | schema | `web/db/migrations/0001_init.sql` or `0002_*` |
| S2 | Define `web/types/checkins.ts` and `web/types/profile.ts` | types | `web/types/*` |
| S3 | Design `web/lib/stats/aggregate.ts` algorithm (includes social-weight hook) | backend | `web/lib/stats/aggregate.ts` |
| A1 | Add session-refresh `web/middleware.ts` | auth | `web/middleware.ts` |
| A2 | Harden sign-in/sign-out UX with loading/error states | frontend | `web/app/page.tsx` |
| C1 | Add long-cache headers for static assets | perf | `web/next.config.ts` |
| C2 | Tune Serwist runtime cache for build assets and dynamic pages | pwa | `web/app/sw.ts` |
| C3 | Add query-persistence buster and restore-error handler | cache | `web/lib/query/persist-options.ts` |
| D1 | Tune Postgres pool config and error handling | db | `web/lib/db/postgres.ts` |
| D2 | Add `work_stats` incremental aggregation and recompute script | db | `web/lib/stats/*`, `web/db/migrations/*` |
| D3 | Add upload size cap and R2 lifecycle guidance | infra | `image-service/src/index.ts`, `image-service/src/r2.ts`, `image-service/wrangler.toml` |
| D4 | Fix Worker wrangler placeholders and add deploy docs | infra | `image-service/wrangler.toml`, `poi-service/wrangler.toml`, `docs/agent/pending-user-actions.md` |
| D5 | Validate `maps_share_url` domain in `/api/places/resolve` | security | `web/app/api/places/resolve/route.ts` |
| D6 | Cap nearby search at 10 km; add rate-limit placeholders for image/POI routes | security | `web/app/api/places/search/route.ts`, image routes |
| D7 | Add `checkin_likes` table and `likes_count` trigger or atomic increment helper | backend | `web/lib/db/checkins.ts` |

### Phase 2 — after `cafe-creation` and `checkin-system` slices

These depend on the cafe/check-in API surface existing.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| API1 | Implement `POST /api/cafes` (create + first check-in, dedupe 409) | backend | `web/app/api/cafes/route.ts` |
| API2 | Implement `GET /api/cafes`, `GET|PATCH /api/cafes/[id]` | backend | `web/app/api/cafes/[id]/route.ts` |
| API3 | Implement `POST /api/checkins` and `PATCH|DELETE /api/checkins/[id]` (soft delete) | backend | `web/app/api/checkins/*` |
| API4 | Implement `POST /api/checkins/[id]/like` and `DELETE` to toggle like | backend | `web/app/api/checkins/[id]/like/route.ts` |
| API5 | Implement `POST /api/navigations` and pending-prompt endpoint | backend | `web/app/api/navigations/*` |
| API6 | Add server-side image processing for creation | backend | `web/lib/images/creation-processor.ts` |
| API7 | Implement `/api/places/external` proxy and extend worker endpoints | backend | `web/app/api/places/external/route.ts`, `poi-service/src/handlers.ts` |
| API8 | Extend `poi-service/src/url.ts` to parse Apple Maps share links | backend | `poi-service/src/url.ts` |
| API9 | Implement `/api/search` (city + filters) merging own cafes, saved POIs, optional live results | backend | `web/app/api/search/route.ts` |
| UI1 | Build `CreationSheet` (Google/Apple link import, manual fallback, dedupe prompt) | frontend | `web/components/cafe/*` |
| UI2 | Build `CheckInDrawer` with sliders, policy chips, note, photo grid | frontend | `web/components/checkin/*` |
| UI3 | Implement `CheckInSuccessCard` and button-morph animation | frontend | `web/components/checkin/*` |
| UI4 | Build `/profile` page (header, stats, My Cafes / My Check-ins tabs) | frontend | `web/app/profile/page.tsx` |
| UI5 | Build `/cafes/[id]` SSR deep-link page with OG meta and onboarding banner | frontend | `web/app/cafes/[id]/page.tsx` |
| UI6 | Design and build `SearchFilter` surface (city + nomad filters) | frontend | `web/components/search/*` |
| STAT | Integrate `work_stats` update into check-in write/edit/soft-delete paths | backend | `web/lib/stats/aggregate.ts`, route handlers |

### Phase 3 — after `map-home` and `discovery-sheet`

These need Apple MapKit and the bottom sheet.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| MAP1 | Implement MapKit full-screen map, markers, clustering, dark mode | frontend | `web/components/map/*`, `web/app/api/mapkit-token/route.ts` |
| MAP2 | Build discovery sheet (PEEK/HALF/FULL) with swipe cards and URL sync | frontend | `web/components/cafe/discovery-sheet.tsx` |
| MAP3 | Add map-tap creation and reverse geocoding | frontend | `web/components/map/*` |
| MAP4 | Build unified search overlay (own + saved + live external) | frontend | `web/components/search/*` |
| MAP5 | Add FAB and auth-gated creation entry points | frontend | `web/components/layout/*` |

### Phase 4 — public beta readiness

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| DEP1 | Create `web/Dockerfile` and `docker-compose.yml` | deploy | repo root / `web/` |
| DEP2 | Add VPS and Worker deploy GitHub workflows | deploy | `.github/workflows/deploy-*.yml` |
| DEP3 | Add DB migration runner to CI | deploy | `.github/workflows/application.yml` |
| DEP4 | Add bundle analyzer and Lighthouse CI | perf | `web/package.json`, CI workflows |
| DEP5 | Add e2e smoke tests for auth and image flows | tests | `web/e2e/*` |

### Post-MVP

- Favorites/collections and "my favorites" list.
- Server-side browsing history or enhanced local recent views.
- Threaded replies on check-in notes.
- User-customizable Work Score dimension weights.
- Owner claims via `cafes.owner_id`.
- Cross-source POI merge / Apple↔Google duplicate resolution.
- Xiaohongshu link import.
- Offline mutation queue.

## Edge cases

| Scenario | Proposed handling |
| --- | --- |
| User pastes a Google/Apple Maps link for an already-imported cafe | `409` from `/api/cafes` with existing cafe; UI prompts to check in. |
| Signed-out user taps "Add cafe" | Show auth gate before creation sheet. |
| No geolocation permission | Default to `profiles.current_city` (Singapore) with a manual locate button; app never blocks. |
| Network offline during creation | Disable creation CTA and show `OfflineBanner`; no mutation queue. |
| User checks in 20 times at the same cafe | Recency-weighted per-user contribution (`0.6^rank`) plus optional social-weight hook. |
| User soft-deletes their latest check-in | Recompute that user's contribution from remaining non-deleted rows; images from the deleted check-in are hidden from `cafes.gallery`. |
| Apple POI not in D1 | Client must `POST /poi/external` first; `GET /poi/:apple_id` returns 404 otherwise. |
| Expired Supabase access token | `web/middleware.ts` refreshes session before route handlers call `getUser()`. |
| Nearby search radius > 10 km | Cap at 10 km; for wider discovery use city search + filters. |
| Image upload > 10 MB | Presigned PUT rejects; UI shows size error before upload. |
| Duplicate `checkin_likes` row | Upsert/toggle: insert or delete; keep `likes_count` on `checkins` in sync via atomic update. |

## Open questions requiring owner decision

- None at this time; all review questions have owner answers. New questions discovered during implementation should be added here.

## Tests / acceptance criteria

- [ ] `preflight.sh` passes after any docs/spec changes.
- [ ] Design-token reconciliation has a visual diff review (browser screenshot of `theme-preview`).
- [ ] `web/middleware.ts` unit test: expired token refreshes before reaching a protected route.
- [ ] `work_stats` aggregation has unit tests for first check-in, repeat check-in edit, soft delete, and social-weight hook.
- [ ] `/api/cafes` POST returns `409` for duplicate `google_place_id` and creates cafe + check-in for new POI.
- [ ] `/api/checkins` POST handles repeat-visit recency weighting and `social_weight = 0` by default.
- [ ] `/api/checkins/[id]/like` toggles like and updates `likes_count` without race conditions.
- [ ] Soft-deleted check-in hides its photos from `/cafes/[id]` gallery.
- [ ] `/api/search` city + filters returns results and respects filter thresholds.
- [ ] Lighthouse performance score ≥ 80 on `/` and `/cafes/[id]` before public beta.
- [ ] Docker image builds and runs `next start` in CI.

## Related files

- `docs/specs/0001-nextjs-migration.md` — canonical architecture and data model.
- `docs/specs/0002-design-system.md` — canonical design tokens and components.
- `docs/specs/0003-testing-and-ci.md` — testing and CI gates.
- `docs/agent/implementation-slices.md` — slice status and dependencies.
- `docs/agent/current-state.md` — phase and active focus.
- `docs/agent/pending-user-actions.md` — owner-only credential/deployment checklist.
