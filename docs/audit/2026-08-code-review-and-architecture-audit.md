# CoffeeMode Code Review & Architecture Audit Report

**Date:** 2026-08-27
**Scope:** Full-scope repository audit across `docs/`, `web/`, `poi-service/`, `image-service/`, database schemas, interaction models, and CI harness.

---

## 1. Executive Summary & Architecture Health

CoffeeMode demonstrates high engineering discipline, type safety, and architectural rigor:
- **Strict Type Safety:** Zero `any` or `as any` types across the TypeScript codebase.
- **SQL Injection Immunity:** 100% parameterized queries across all database access layers.
- **Transaction & Concurrency Safety:** Clear connection isolation (`withTransaction`) and row-level locking (`FOR UPDATE`) on shared entity updates.
- **Centralized Configuration (DG107):** Deeply integrated YAML configs (`web/config/app.yaml` & `rate-limits.yaml`) loaded with strict schemas and frozen defaults.
- **Testing Foundation:** 516 unit/mocked tests passing alongside real Postgres/PostGIS and MinIO/R2 integration gates.

However, several critical runtime edge cases, query scalability flaws, interaction fragility, and "vibe-coding" synthetic test patterns require remediation.

---

## 2. Docs, Specs & Implementation Progress vs. Reality

| Specification / Artifact | Spec / ADR Target | Actual Code Reality | Status | Discrepancy & Drift |
|---|---|---|---|---|
| **App Architecture** | ADR-0001, Spec 0001 | Next.js 16 Standalone, React 19, Turbopack | **Synchronized (100%)** | Fully implemented in `web/`. |
| **Database Migrations** | ADR-0002, Spec 0001 | 12 SQL migrations in `web/db/migrations/` | **Doc Metadata Lag** | `docs/agent/current-state.md` lists migrations up to 0008; 0009–0012 are live. |
| **Search & Discovery Backend** | Spec 0004, Search Filters v1 | `web/app/api/search/route.ts`, `web/lib/search/` | **Doc Status Lag** | `docs/agent/implementation-slices.md` marks `search-filters` as `READY`, but backend is already complete. |
| **Profile Page** | Profile Page v1 | `web/app/profile/page.tsx`, `web/components/profile/` | **Doc Status Lag** | Manifest marks `profile-page` as `READY`, but `/profile` and APIs are implemented. |
| **Design Artifacts** | `docs/design/*-v1.md` | 7 artifacts grilled (DG21–DG124) | **Doc Metadata Lag** | File headers remain `Draft — pending owner approval` despite grill program completion. |
| **Map-Bound Features** | `map-home`, `map-discovery-integration` | Blocked on Apple Developer Program | **Cleanly Blocked** | Properly documented in `docs/agent/pending-user-actions.md`. |

---

## 3. Database Architecture, Indexing & Query Performance

### 3.1 Spatial Indexing & Geospatial Queries
- **PostGIS GiST on `cafes`**:
  `web/db/migrations/0001_init.sql` creates `idx_cafes_location` on `location geography(POINT, 4326)`.
  - **Issue**: Non-partial index. Queries filter on `where deleted_at is null and ST_DWithin(...)`. Soft-deleted tombstone rows pollute the index, forcing unnecessary heap fetches.
  - **Fix**: Upgrade to partial index: `CREATE INDEX idx_cafes_location_active ON cafes USING gist (location) WHERE deleted_at IS NULL;`.
- **Cloudflare D1 / SQLite Geospatial Prefilter**:
  `poi-service/src/store.ts` uses composite B-Tree `(lat, lng)` with `WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`.
  - **Issue**: Range query on `lat` prevents index seek acceleration on `lng`. SQLite scans the entire latitude band across the globe and filters `lng` sequentially. Furthermore, `ORDER BY name ASC LIMIT 100` before in-memory Haversine distance filtering truncates closest POIs if their names are alphabetically later.

### 3.2 Foreign Key Index Blindspots & Cascade Deletion Risks
Missing indexes on foreign keys cause full table sequential scans whenever parent records are deleted or checked:
- `checkin_likes(user_id)` lacks an index (`checkin_likes_checkin_id_user_id_key` only indexes `(checkin_id, user_id)`), causing sequential scans on profile deletion.
- `navigations(cafe_id)` and `image_upload_intents(user_id)` lack foreign key indexes.
- `navigations(user_id)` is indexed only for `where resolved = false`.

### 3.3 Critical Query Scalability Flaw: Search In-Memory Filtering
In `web/lib/search/search-service.ts`:
- `searchCafesInDb` orders by `name asc limit 100` in SQL before `executeSearch` evaluates work filters (`wifi`, `outlets`, `quiet`, `open_now`) in Node memory.
- In cities with >100 cafes, matching cafes starting with letters D-Z are permanently dropped.
- In `web/lib/db/search.ts`, `lower(city) = lower($2)` cannot use `idx_cafes_city` without a functional index (`CREATE INDEX ON cafes (lower(city))`).

### 3.4 Ineffective GIN Indexes
`web/db/migrations/0002_checkins_and_indexes.sql` created `idx_cafes_gallery` and `idx_checkins_photos` using `jsonb_path_ops`. However, `@>` containment is only used inside a `CASE` expression in `web/lib/images/complete.ts` on an already row-locked record. These GIN indexes add write amplification on every photo upload without aiding query plans.

---

## 4. Code Quality, Duplication & Over-Engineering

### 4.1 Duplicated Logic Across Modules
1. **Apple MapKit FNV-1a Stable ID Generation**:
   - Duplicated verbatim in `poi-service/src/handlers.ts` and `web/components/cafe/apple-place-search.tsx`.
   - **Fix**: Centralize in `web/shared/places/geo.ts`.
2. **Maps Share URL Validation**:
   - Separate regex and domain parsing in `web/lib/places/validate-maps-url.ts` vs `poi-service/src/url.ts`.
   - **Fix**: Unify inside `web/shared/places/`.
3. **Coordinate Bounds Assertions**:
   - Repeated inline checks `(lat < -90 || lat > 90)` across `web/lib/db/cafes.ts`, `web/lib/api/places.ts`, and `poi-service/src/handlers.ts` instead of standardizing on `web/shared/places/geo.ts:isValidCoordinate`.

### 4.2 Over-Engineering & Single-Use Abstractions
- **Pass-through Re-export**: `web/lib/search/distance.ts` is a 2-line file re-exporting `haversineDistanceKm` as `calculateDistanceKm`, only used in a unit test. Delete and point tests directly to `@shared/places/geo`.
- **Hardcoded Upload Cap**: `web/components/cafe/cafe-creation-sheet.tsx` defines `const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;` violating DG107 instead of importing `MAX_IMAGE_FILE_BYTES` from `web/shared/images/constants.ts`.

---

## 5. UI/UX, Interaction Design & Frontend Architecture

### 5.1 Discovery Sheet Interaction Fragility
- **Key-Driven Unmount / Remount Destruction**:
  In `web/components/discovery/mobile-sheet.tsx`:
  `<DetailContent key={`${selectedCafeId}-${snap}`} ... />` forces full destruction/remount on every sheet snap (`half` <-> `full`), dropping scroll position, cover carousel loading state, and keyboard focus.
- **Stale PointerEvent Drag Handoff**:
  In `web/components/discovery/mobile-sheet.tsx`, React synthetic `PointerEvent` objects are saved across event loop ticks in `pendingPull.current` before calling `dragControls.start(pending.event)`. This causes gesture dropped-frames and pointer capture failures on mobile Safari and Chrome Android.

### 5.2 Desktop Layout Collision
In `web/app/page.tsx`, the server renders a full marketing landing page and mounts `<DiscoveryHome />`. On desktop ($\ge 1024\text{px}$), `desktop-discovery.tsx` renders with `fixed inset-y-0 left-0 z-30` (780px fixed width), directly overlaying and obscuring the SSR landing page and auth header.

### 5.3 Design System 2026 Token Violations (Spec 0002)
- **Invalid `primary` Tailwind Utility Classes**:
  HeroUI v3 and CoffeeMode tokens use `--color-accent` (not `primary`). `web/app/globals.css` does not define `--color-primary`. However, `web/components/profile/profile-view.tsx` uses `border-primary`, `bg-primary`, and `text-primary`, rendering unstyled/transparent borders and backgrounds in production.

### 5.4 Monolithic Profile Component
`web/components/profile/profile-view.tsx` spans 900+ lines in a single file, intertwining infinite scroll queries, inline text editing, city modals, recent search subscriptions, and custom animation hooks.

---

## 6. Vibe-Coding Hazards & Systemic Risks

### 6.1 The "Synthetic Mock" Trap in Unit Tests
In `web/tests/cafes.test.ts`, chaining 10 sequential mocked resolve values tests only that the code calls `client.query` in an exact hardcoded order. It does not test SQL syntax, column mapping, foreign key constraints, or rollback semantics. Real Postgres integration tests (`web/tests/integration/db.integration.test.ts`) must be the primary verification gate.

### 6.2 Timezone & Coordinate Boundary Defense
In `web/lib/db/cafes.ts`: `tzLookup(lat, lng)` throws `RangeError("invalid coordinates")` when passed coordinates with `|lat| > 90`, `|lng| > 180`, or non-finite `NaN` values. While `parseCreateCafeBody` validates HTTP inputs at the route layer, wrapping `tzLookup` with defensive `try...catch` and fallback to city timezone or `"UTC"` ensures internal callers and coordinate anomalies are safely handled without throwing unhandled exceptions.

### 6.3 Docker Compose Local Dev Flake
In `docker-compose.yml`, both `miniflare-poi` and `miniflare-image` execute `apt-get update && apt-get install` and `npm install` inside container entrypoint commands on startup, making local developer bootstrapping dependent on Debian/npm network availability.

---

## 7. Actionable Priority Roadmap

### P0 — Critical Correctness
1. **`tzLookup` Exception Handling**: Wrap `tzLookup` in `try...catch` in `web/lib/db/cafes.ts` with fallback to UTC or city default.
2. **Search SQL Filter Pushdown**: Push nomad work filters into SQL `WHERE` clauses or rank by relevance rather than naive alphabetical `LIMIT 100`.
3. **Broken Tailwind v4 Classes**: Replace `border-primary`, `bg-primary`, `text-primary` with `border-accent`, `bg-accent`, `text-accent-foreground` in `profile-view.tsx`.

### P1 — Database & Performance
1. **Cascade FK Indexes**: Add migration adding indexes on `checkin_likes(user_id)`, `navigations(cafe_id)`, `image_upload_intents(user_id)`.
2. **Partial GiST Index**: Upgrade `idx_cafes_location` to `WHERE deleted_at IS NULL` and drop unused `idx_cafes_gallery` / `idx_checkins_photos` GIN indexes.
3. **Mobile Sheet Detent Key**: Remove dynamic `key={`${selectedCafeId}-${snap}`}` from `DetailContent` in `mobile-sheet.tsx`.

### P2 — Architecture & Hygiene
1. **FNV-1a & Maps URL Deduplication**: Move shared algorithms to `web/shared/places/`.
2. **Profile Component Decomposition**: Split `profile-view.tsx` into modular subcomponents.
3. **Doc & Slice Synchronization**: Update `docs/agent/current-state.md` and `implementation-slices.md`.
