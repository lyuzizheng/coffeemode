# 0004. Product Decisions and Backlog

## Goal

Capture the output of the batched subagent review covering frontend/UX design, check-in & social semantics, cafe creation & discovery, and auth/cache/perf/DB/deploy. This spec proposes concrete product and engineering decisions, surfaces the decisions that still need an owner call, and lines up the resulting implementation backlog by phase.

## Status

Draft — decisions in this spec are **proposed** and require owner confirmation before they are merged into the canonical specs (`0001`, `0002`) or the implementation-slices manifest.

## Review scope

Four read-only subagent reviews ran in parallel against the current `main` tree (post-PWA code-quality cleanup):

1. **Frontend/UX design** — design-system consistency, `/profile`, check-in success card, creation flow.
2. **Check-in & social semantics** — "every review is a check-in", likes/favorites, scoring weight, profile records.
3. **Cafe creation & discovery** — entry methods (Google Maps import, map-tap, search, manual), edge cases, POI service gaps.
4. **Auth/cache/perf/DB/deploy** — session middleware, caching, performance, database indexes, deploy pipeline.

## Stable decisions

These decisions are proposed and require owner confirmation before they are merged into specs `0001` / `0002` or the implementation-slices manifest.

### Design system

1. **HeroUI v3 is the canonical component library.** Remove the stale Shadcn directive in `.windsurf/rules/project-rule.md` so future agents do not introduce a second visual language.
2. **Color tokens must be reconciled between `docs/specs/0002-design-system.md` and `web/app/globals.css`.** Either add a real `--secondary` sage brand token or explicitly document the single-accent + status palette. Align values and names.
3. **Codify the radius scale in `globals.css`.** Add `--radius-sm/md/lg/xl/2xl/3xl` and fix `.card` to use `--radius-md` (12px) per the spec.
4. **Shadow tokens must match spec or the spec must be updated.** Keep the warm espresso tint.
5. **In-app type scale ceiling is `text-2xl` (2rem).** Sandbox `theme-preview` hero sizes; page titles and cafe names use `font-display` inside the fixed scale.
6. **Mount `<Toast.Provider>` in `web/app/providers.tsx`.** HeroUI toast is the canonical success/error surface.

### Check-in & social semantics

7. **"Every review is a check-in" stays literal.** No separate `reviews` table in MVP. A `checkins` row carries scores, policies, note, and photos.
8. **Likes and favorites are post-MVP.** They do **not** affect `work_stats` or cafe scores. The slider-only model (`wifi/outlets/seats/temp/coffee/overall`) is the only rating signal.
9. **Check-in `note` is a one-off review snippet.** Threaded replies are post-MVP.
10. **`/profile` "My cafes" means cafes created by the user (`cafes.created_by`).** A separate "My visits" list can be derived from `checkins` later if needed.
11. **Browsing/view history is out of MVP scope.** If needed, use lightweight client-side recent views; server-side history is post-MVP.
12. **Check-ins support edit and hard delete.** Add `updated_at` to `checkins`. Delete recomputes `work_stats` from remaining rows for that user.
13. **Whether deleting a check-in removes its photos from `cafes.gallery` is unresolved.** Two options:
    - A. Keep photos in the gallery (attribution stays).
    - B. Track source per image (`{ ..., source: { type, id } }`) and remove on delete.
    **Recommendation:** start with A (simpler, fewer regrets); revisit if moderation needs it.

### Cafe creation & discovery

14. **Creation is the first check-in.** `POST /api/cafes` creates the cafe and a `checkins` row with `is_creation=true` in one transaction.
15. **Dedupe is mandatory.** Check `google_place_id` / `apple_poi_id` before insert. If a match exists, return `409` with the existing cafe and a "Check in here" prompt.
16. **Four creation entry methods are supported eventually:** Google Maps link import, MapKit map-tap, search-result selection, manual entry. MVP only needs the link-import path and a manual fallback; map-tap/search are blocked on `map-home`.
17. **Cross-source (Google ↔ Apple) duplicate resolution is undefined and post-MVP.** Physical location dedupe is intentionally not solved for MVP.
18. **Offline creation is disabled in MVP.** Show the offline banner and disable the creation CTA. No mutation queue.

### Auth/cache/perf/DB/deploy

19. **Session-refresh middleware is required.** Create `web/middleware.ts` using `@supabase/ssr` to refresh tokens on each request.
20. **Static and PWA assets get long immutable cache headers in `next.config.ts`.** Apply to `/_next/static/*`, `/icons/*`, `/fonts/*`.
21. **Serwist runtime cache must be tuned.** `/_next/static/*` → `CacheFirst` 1-year; dynamic routes (`/cafes/*`, `/profile`) → `NetworkOnly`.
22. **Postgres pool needs config and error handling.** Set `max`, idle/connection timeouts, `on('error')`, and a graceful shutdown hook.
23. **Add missing indexes:** `idx_cafes_created_by`, GIN on `cafes.gallery` and `checkins.photos` for `@>` containment, `idx_checkins_user (user_id, visited_at desc)`, `idx_cafes_apple_poi_id`, `idx_profiles_current_city`.
24. **`work_stats` incremental aggregation must be implemented** per `0001:236-258` with a nightly full-recompute fallback.
25. **Image upload needs a size cap and R2 lifecycle rule.** Cap at 10 MB in presigned PUT conditions; document lifecycle for abandoned `original/` objects.
26. **VPS deploy needs a Dockerfile and GitHub workflow** before public beta.
27. **Worker deploy placeholders must be fixed and documented** (`R2_ACCOUNT_ID`, D1/KV IDs, secrets).
28. **Add DB migration runner to CI** (dry-run on PR, apply on release).

## Data/API/UI behavior

This section is the implementation backlog. Tasks are grouped by phase.

### Phase 1 — now (no Apple Developer / map dependency)

These tasks can proceed while `map-home` is blocked and before live credentials are configured. Use mocked data for UI prototypes where needed.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| F1 | Reconcile design tokens and remove stale Shadcn rule | design | `.windsurf/rules/project-project.md`, `web/app/globals.css`, `docs/specs/0002-design-system.md` |
| F2 | Mount `<Toast.Provider>` and wire auth success/error states | frontend | `web/app/providers.tsx`, `web/app/page.tsx`, `web/app/auth/actions.ts` |
| F3 | Build static UI prototypes in `theme-preview`: `ScoreSlider`, `PolicyChips`, `CheckInSuccessCard`, `ProfileHeader` | design | `web/app/theme-preview/sections/*` |
| F4 | Add i18n namespaces: `profile`, `create`, `checkIn`, `success` | i18n | `web/messages/en.json`, `web/messages/zh.json` |
| S1 | Add `checkins.updated_at` and missing indexes | schema | `web/db/migrations/0001_init.sql` or `0002_*` |
| S2 | Define `web/types/checkins.ts` and `web/types/profile.ts` | types | `web/types/*` |
| S3 | Design `web/lib/stats/aggregate.ts` algorithm | backend | `web/lib/stats/aggregate.ts` |
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
| D6 | Cap search radius and add rate-limit placeholders | security | `web/app/api/places/search/route.ts`, image routes |

### Phase 2 — after `cafe-creation` and `checkin-system` slices

These depend on the cafe/check-in API surface existing.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| API1 | Implement `POST /api/cafes` (create + first check-in, dedupe 409) | backend | `web/app/api/cafes/route.ts` |
| API2 | Implement `GET /api/cafes`, `GET|PATCH /api/cafes/[id]` | backend | `web/app/api/cafes/[id]/route.ts` |
| API3 | Implement `POST /api/checkins` and `PATCH|DELETE /api/checkins/[id]` | backend | `web/app/api/checkins/*` |
| API4 | Implement `POST /api/navigations` and pending-prompt endpoint | backend | `web/app/api/navigations/*` |
| API5 | Add server-side image processing for creation | backend | `web/lib/images/creation-processor.ts` |
| API6 | Implement `/api/places/external` proxy and extend worker endpoints | backend | `web/app/api/places/external/route.ts`, `poi-service/src/handlers.ts` |
| UI1 | Build `CreationSheet` (link import, manual fallback, dedupe prompt) | frontend | `web/components/cafe/*` |
| UI2 | Build `CheckInDrawer` with sliders, policy chips, note, photo grid | frontend | `web/components/checkin/*` |
| UI3 | Implement `CheckInSuccessCard` and button-morph animation | frontend | `web/components/checkin/*` |
| UI4 | Build `/profile` page (header, stats, My Cafes / My Check-ins tabs) | frontend | `web/app/profile/page.tsx` |
| UI5 | Build `/cafes/[id]` SSR deep-link page with OG meta and onboarding banner | frontend | `web/app/cafes/[id]/page.tsx` |
| STAT | Integrate `work_stats` update into check-in write/edit/delete paths | backend | `web/lib/stats/aggregate.ts`, route handlers |

### Phase 3 — after `map-home` and `discovery-sheet`

These need Apple MapKit and the bottom sheet.

| ID | Task | Area | Key files |
| --- | --- | --- | --- |
| MAP1 | Implement MapKit full-screen map, markers, clustering, dark mode | frontend | `web/components/map/*`, `web/app/api/mapkit-token/route.ts` |
| MAP2 | Build discovery sheet (PEEK/HALF/FULL) with swipe cards and URL sync | frontend | `web/components/cafe/discovery-sheet.tsx` |
| MAP3 | Add map-tap creation and reverse geocoding | frontend | `web/components/map/*` |
| MAP4 | Build unified search overlay (own cafes + saved POIs + live external) | frontend | `web/components/search/*` |
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

- Favorites/collections and `checkin_likes` (social only, no score impact).
- Server-side browsing history or local recent-views enhancement.
- Threaded replies on check-in notes.
- User-customizable Work Score dimension weights.
- Owner claims via `cafes.owner_id`.
- Cross-source POI merge / Apple↔Google duplicate resolution.
- Xiaohongshu link import.
- Offline mutation queue.

## Edge cases

| Scenario | Proposed handling |
| --- | --- |
| User pastes a Google Maps link for an already-imported cafe | `409` from `/api/cafes` with existing cafe; UI prompts to check in. |
| Signed-out user taps "Add cafe" | Show auth gate (bottom sheet or modal) before creation sheet. |
| No geolocation permission | Default to `profiles.current_city` (Singapore) with a manual locate button; app never blocks. |
| Network offline during creation | Disable creation CTA and show existing `OfflineBanner`; no mutation queue. |
| User checks in 20 times at the same cafe | Recency-weighted per-user contribution (`0.6^rank`) keeps one user from dominating. |
| User deletes their latest check-in at a cafe | Recompute that user's contribution from remaining rows; update `work_stats`. |
| Check-in photo deletion | Option A: photos remain in `cafes.gallery`; option B requires adding `source` to image JSONB. |
| Apple POI not in D1 | Client must `POST /poi/external` first; `GET /poi/:apple_id` returns 404 otherwise. |
| Expired Supabase access token | `web/middleware.ts` refreshes session before route handlers call `getUser()`. |
| Search radius > 100 km | Cap at 100 km to prevent expensive scans. |
| Image upload > 10 MB | Presigned PUT rejects; UI shows size error before upload. |

## Open questions requiring owner decision

1. **Design tokens:** Adopt the proposed single-accent palette or add a real `--secondary` sage brand token? (Design review recommends single-accent + status colors.)
2. **Check-in photo deletion:** Keep photos in gallery on check-in delete (option A) or track source and remove them (option B)?
3. **Check-in note threading:** Confirm post-MVP. The proposed spec leaves `note` as a one-off snippet.
4. **Likes/favorites:** Confirm post-MVP and no impact on score.
5. **Profile "My cafes":** Confirm it means `cafes.created_by` in MVP, with "My visits" as a later addition.
6. **Creation success feedback:** Bottom success card with coffee-steam micro-animation and auto-dismiss after 5s. Confirm.
7. **Offline behavior:** Disable creation with banner; no queue. Confirm.
8. **Google Places photos:** Add a short-lived `/api/places/photos` proxy and accept `image/*` conversion to WebP client-side. Confirm.

## Tests / acceptance criteria

- [ ] `preflight.sh` passes after any docs/spec changes.
- [ ] Design-token reconciliation has a visual diff review (browser screenshot of `theme-preview`).
- [ ] `web/middleware.ts` unit test: expired token refreshes before reaching a protected route.
- [ ] `work_stats` aggregation has unit tests for first check-in, repeat check-in edit, and delete.
- [ ] `/api/cafes` POST returns `409` for duplicate `google_place_id` and creates cafe + check-in for new POI.
- [ ] `/api/checkins` POST handles repeat-visit recency weighting correctly.
- [ ] Lighthouse performance score ≥ 80 on `/` and `/cafes/[id]` before public beta.
- [ ] Docker image builds and runs `next start` in CI.

## Related files

- `docs/specs/0001-nextjs-migration.md` — canonical architecture and data model.
- `docs/specs/0002-design-system.md` — canonical design tokens and components.
- `docs/specs/0003-testing-and-ci.md` — testing and CI gates.
- `docs/agent/implementation-slices.md` — slice status and dependencies.
- `docs/agent/current-state.md` — phase and active focus.
- `docs/agent/pending-user-actions.md` — owner-only credential/deployment checklist.
