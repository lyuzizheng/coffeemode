# 0001. Next.js Full-Stack Rewrite

## Goal

Rewrite CoffeeMode as a full-stack Next.js application — **the coworking review platform for digital nomads**. CoffeeMode's moat is data Google Maps doesn't have: wifi quality, power outlets, seat comfort, temperature, coffee quality, and max stay policy — all crowd-sourced through 打卡 (check-ins).

Drop the Java Spring Boot backend entirely. CoffeeMode owns its POI database; Google Places and Apple Maps are external references and import sources, never authoritative.

This is a rewrite, not a migration. The old Vite SPA (`_archive-coffeemode-frontend/`) and Java backend (`_archive-coffeemode-backend/`) are archived reference material only.

## Status

Accepted (revised 2026-08-23 — DG124 (round-14 Q10 resolved by redesign): /cafes/[id] SSR shell hydrates in place into the map app at FULL sheet, DeepLinkBanner abolished, /?cafe= app entry retired (amends DG104/DG106); 2026-08-23 — onboarding grill round 15: welcome card immediate + non-modal, wrong-city correction via Select only, Skip lands on the IP-detected city, denied-permission re-entry via locate button with one-time settings toast, no recenter after user pan, blue dot session-persistent, out-of-coverage geolocation auto-creates the city with a first-nomad message, profiles.onboarded authoritative across devices, offline grant still dismisses (DG114–DG123); 2026-08-23 — grill round 14 completed: locale-independent canonical URL made permanent (DG110), 404 nearby-cafes recovery + global location-permission contract (DG111–DG112), check-in feed default = Newest (DG113); 2026-08-23 — cafe URL scheme + SEO/AI-search readiness (JSON-LD, sitemap, llms.txt), two-part cafe page (SSR aggregate shell + client-loaded feed), universal typed config under web/config (DG104–DG107); share flow amended — copy-link always visible, WeChat copy-link popover day-one (DG109), OG description = overall score + curiosity hook (DG108); 2026-08-22 — navigation→check-in prompt reworked: anonymous sessions via Supabase anonymous sign-in, navigations.outcome funnel column, next-day earliest prompt, three-option no-× card, 3-month expiry, one-per-session queue (DG76–DG90); 2026-08-21 — check-in write integrity and UX contracts: upload-on-select photos with auth-gated presigned issuance, idempotency keys, edit-does-not-refresh-recency, 90-day Same-as-last-time window, 1-per-cafe-per-24h limit, 500-char notes, 6-photo cap, bidirectional temperature scale, multi-provider sign-in gate (DG59–DG73); universal YAML-configured rate limiting across all APIs and scripts (DG74); search-as-you-type ≥3 chars with 400ms debounce, top-10 suggestions without pagination, weak-results threshold, removable filter chips, session-scoped filters, food-only D1 caching, distance labeling (DG44–DG49, DG51–DG58); launch expands from Singapore-only to ~10 launch cities with ISO/IATA city codes (DG50); overall slider mandatory per check-in (DG40); creation composes logged-out with local draft, sign-in at publish (DG39); desktop detail becomes a second left column (DG42); PEEK Work-score watermark (DG43); 2026-08-20 — discovery ranking, recovery, accessibility, missing-cafe, responsive, feed, anonymity, dismissal, and gesture contracts; 2026-08-19 — responsive discovery contract and Kimi K3 design gate; 2026-08-18 — parallel MapKit/non-map development plan; 2026-08-13 — OAuth redirectTo allowlist/fallback, session-refresh proxy cookie guard, profile upsert failure handling; earlier 2026-08-07 — Supabase auth-only split, self-hosted Postgres data layer, image-service Worker, slider scoring, creation-as-first-checkin)

## Stable decisions

### Framework

```text
Next.js 15+ (App Router, Turbopack dev)
React 19 (Server Components + Client Components)
TypeScript strict mode
Single package in web/ (no monorepo)
Tailwind CSS v4
HeroUI v3 (@heroui/react 3.2+) — component library
Framer Motion — animation (HeroUI peer dep, also used directly)
next-intl — i18n (English primary + Chinese, from day one)
```

### Project structure

```text
coffeemode/
  web/                      # Next.js full-stack application
    app/
      layout.tsx            # Root: fonts, HeroUIProvider, theme, metadata
      page.tsx              # Home: full-screen map + swipe cards + bottom sheet
      cafes/
        [id]/
          page.tsx          # Cafe detail (SSR deep link only: share/SEO)
      auth/
        actions.ts          # OAuth sign-in / sign-out server actions
        callback/
          route.ts          # OAuth callback handler
      api/
        cafes/
          route.ts          # Create cafe (= first check-in), list
          [id]/
            route.ts        # Single cafe read/update
        images/
          upload/
            route.ts        # Request presigned R2 URL from image-service
          complete/
            route.ts        # Process uploaded original into capped original/card/thumbnail + update DB
        places/
          search/
            route.ts        # POI cache service search proxy
          resolve/
            route.ts        # POI cache service resolve proxy (Google/Apple Maps link → POI)
        checkins/
          route.ts          # Check-in (打卡) CRUD
        navigations/
          route.ts          # Navigation tracking
        mapkit-token/
          route.ts          # MapKit JS JWT minting
    components/
      map/                  # MapKit JS components (all "use client")
      cafe/                 # Swipe cards, bottom sheet, detail content
      checkin/              # Check-in UI, sliders, policy chips
      layout/               # Header, FAB, onboarding
      ui/                   # HeroUI overrides / custom primitives
    lib/
      auth/                 # Supabase SSR client + OAuth server actions (server + browser clients as added)
      db/                   # Postgres query helpers (server-side only)
      images/               # Image-service client + sharp processor
      places/               # Server-only POI cache service client (proxies POI Worker; never calls Google directly)
      mapkit/               # MapKit JS token, init helpers
      stats/                # Incremental work_stats aggregation
    hooks/                  # TanStack Query hooks, geolocation
    types/                  # Shared TypeScript types
    proxy.ts                # Supabase session refresh (Next.js 16 middleware convention)
    app/globals.css         # Tailwind v4 + HeroUI plugin + tokens
    next.config.ts
    tsconfig.json
    package.json
  docs/                     # Documentation system
  poi-service/              # POI cache microservice (Workers + D1 + KV)
  image-service/            # Image upload microservice (Workers + R2 presigned URLs)
  .agents/                  # Agent workflows
```

### Data layer — split responsibilities

```text
Supabase           → AUTH (Apple + Google OAuth, sessions) + main Postgres/PostGIS
                     (owner decision 2026-08-28, 0004 decision 34a; free tier first,
                     upgrade triggers in 0004 Post-MVP)
Cloudflare Workers → poi-service (D1 + KV) + image-service (R2) microservices
VPS                → Next.js app only (no database)
Local dev/CI       → same postgis/postgis:16-3.4 image (docker-compose locally, pinned service container in CI) — unchanged
```

- The client never talks to Postgres. All data access goes through Next.js route handlers (server-side), which verify the Supabase session first.
- Product-table data stays server-mediated: route handlers use the pooled Postgres connection, and the tables must NOT be reachable through Supabase's Data API (PostgREST/GraphQL) with the browser anon key — new projects no longer auto-expose new tables, and default grants to `anon`/`authenticated` are revoked at provisioning as a belt-and-suspenders step (`docs/agent/pending-user-actions.md` §2). The anon key is used only for auth flows.
- Postgres connection: standard `pg` Pool (server-side only), fail-closed SSL (#41). PostGIS enabled via `create extension postgis` (Supabase catalog). Pick the Supabase region closest to the VPS — route handlers run multi-round-trip transactions, so RTT multiplies.

#### Tables (7 total: 5 product + 2 infra — deliberately minimal; applied via migrations 0001–0012)

```sql
-- 1. profiles: app-side user record, keyed by Supabase auth user id
create table profiles (
  id            uuid primary key,        -- = Supabase auth.users.id
  display_name  text not null,
  avatar_url    text,
  current_city  text default 'singapore',
  last_location geography(POINT, 4326),
  last_seen_at  timestamptz,
  created_at    timestamptz default now()
);

-- 2. cafes: CoffeeMode's own POI database
create table cafes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique,
  name            text not null,
  location        geography(POINT, 4326) not null,
  address         text,
  city            text default 'singapore',
  description     text,
  cover           text,                   -- R2 key
  gallery         jsonb default '[]',     -- [{id, original, card, thumbnail, w, h, by, at, source}]
  opening_hours   jsonb,                  -- {mon:{open,close},...} + hours_source
  tz              text,                   -- IANA timezone (e.g. 'Asia/Seoul'); open-now evaluates cafe-local (web/lib/hours.ts)
  price_range     smallint,               -- 1-4
  google_place_id text,
  apple_poi_id    text,
  created_by      uuid references profiles(id),
  owner_id        uuid references profiles(id),  -- post-MVP owner claim
  work_stats      jsonb default '{}',     -- incremental aggregation cache (see below)
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz             -- 0009: soft delete; tombstone keeps id + location for 404 recovery (DG111)
);
create index idx_cafes_location on cafes using gist (location);
create index idx_cafes_name_fts on cafes using gin (to_tsvector('simple', name));
-- 0011: tombstone-aware — a soft-deleted cafe does not block re-importing the same POI
create unique index idx_cafes_gplace on cafes (google_place_id) where google_place_id is not null and deleted_at is null;  -- dedupe
create unique index idx_cafes_apple_poi_id on cafes (apple_poi_id) where apple_poi_id is not null and deleted_at is null;
create index idx_cafes_city on cafes (city);
create index idx_cafes_created_by on cafes (created_by);
create index idx_cafes_gallery on cafes using gin (gallery jsonb_path_ops);
create index idx_profiles_current_city on profiles (current_city);

-- 3. checkins: 打卡 — every review is a check-in (creation is the first one)
create table checkins (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid references cafes(id) on delete cascade,
  user_id     uuid references profiles(id),
  is_creation boolean default false,      -- the check-in that created the cafe
  -- Sliders, all 0-100 decimal, only dimensions the user scored:
  --   wifi, outlets, seats, temp, coffee, overall (personal subjective)
  scores      jsonb not null default '{}',
  -- Policies (nomad essentials):
  max_stay    text,                       -- unlimited | 3h | 2h | 1h | peak
  note        text,
  photos      jsonb default '[]',         -- [{id, original, card, thumbnail, w, h, by, at, source}]
  likes_count int default 0,              -- denormalized; source of truth is checkin_likes
  visited_at  timestamptz default now(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted_at  timestamptz                 -- soft delete; null = active
);
create index idx_checkins_cafe on checkins (cafe_id, visited_at desc) where deleted_at is null;
create index idx_checkins_user on checkins (user_id, visited_at desc) where deleted_at is null;
create index idx_checkins_user_cafe on checkins (user_id, cafe_id, visited_at desc) where deleted_at is null;
create index idx_checkins_likes on checkins (cafe_id, likes_count desc, visited_at desc) where deleted_at is null;
create index idx_checkins_photos on checkins using gin (photos jsonb_path_ops);

-- 4a. checkin_likes: social signal for comment ranking and future scoring weight
create table checkin_likes (
  id          uuid primary key default gen_random_uuid(),
  checkin_id  uuid references checkins(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (checkin_id, user_id)
);

-- 4. navigations: drives the ClassPass-style "did you visit?" prompt
-- Implementation status: applied migration 0001 created only
-- id/cafe_id/user_id/resolved/created_at. The queue columns below
-- (outcome/ask_count/last_asked_at — DG80/DG91) land with the
-- navigation-prompt slice (#149) and its reusable prompt queue.
create table navigations (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid references cafes(id) on delete cascade,
  user_id     uuid references profiles(id),
  resolved    boolean default false,
  outcome     text,                 -- visited | wont_go | not_yet | auto (DG80)
  ask_count   int default 0,        -- times the prompt was answered 还没去 (DG91)
  last_asked_at timestamptz,        -- eligibility: next ask ≥ 1 day later (DG91)
  created_at  timestamptz default now()
);
create index idx_nav_pending on navigations (user_id) where resolved = false;
```

Notes:

```text
- No cafe_images table: image metadata lives in cafes.gallery / checkins.photos JSONB
  (normalization to an images table is deferred — revisit trigger in 0004 Post-MVP)
- checkin_likes table exists in MVP to power comment ranking and预留 a social-weight hook
- No cafe_likes table: cafe popularity is already expressed via work_stats aggregation
- No votes/policies tables: everything folds into the check-in row
- Favorites/collections, follows, owner claims: post-MVP (owner_id column reserved);
  favorites land as cafe_favorites(user_id, cafe_id) composite PK — like ≠ favorite
  (0004 decision 8a, #254)
- Soft delete: checkins.deleted_at; photos from a deleted check-in are hidden from cafes.gallery via source;
  cafes.deleted_at (0009) tombstones keep id + location; provider unique indexes are tombstone-aware (0011)
- Infra tables (not product domain): rate_limits (0003 — distributed token bucket, one atomic
  UPSERT per check, web/lib/rate-limit/postgres.ts) and image_upload_intents (0006 — binds a
  presigned imageUuid to its issuing user, single-use DELETE ... RETURNING inside the creation
  transaction, web/lib/db/image-uploads.ts). Both stay in Postgres: KV cannot do an atomic
  single-use consume, is eventually consistent, and caps at 1k writes/day on the free tier
```

#### Scoring model — sliders, not votes

```text
All scoring is personal and subjective: every dimension is a 0-100 slider.
No "is this cafe laptop-friendly" abstractions — only observable facts:

  📶 wifi      how good was the wifi
  🔌 outlets   how available were power outlets
  🪑 seats     how comfortable were seats/tables
  🌡 temp      how comfortable was the temperature
  ☕ coffee    how good was the coffee
  ✨ overall   personal subjective score

Each check-in stores only the sliders the user actually moved.
No defaults, no 50-anchor: an unmoved slider is simply not recorded.
```

#### Aggregation — incremental, app-side

`cafes.work_stats` is an aggregation cache updated incrementally on each write (no heavy SQL rollups, no materialized views). Local VPS CPU/RAM/disk are free to use. Aggregations ignore soft-deleted check-ins (`deleted_at is null`).

```json
{
  "n_users": 12,
  "n_checkins": 31,
  "dims": {
    "wifi":    { "sum": 894.5, "n": 11 },
    "outlets": { "sum": 558.0, "n": 9  },
    "seats":   { "sum": 745.0, "n": 10 },
    "temp":    { "sum": 1058.4,"n": 12 },
    "coffee":  { "sum": 841.2, "n": 12 },
    "overall": { "sum": 922.8, "n": 12 }
  },
  "policies": {
    "max_stay":  { "unlimited": 8, "2h": 3 }
  },
  "experience_score": 78.2,
  "composite_score": 74.6,
  "updated_at": "2026-08-02T10:00:00Z"
}
```

Two headline scores:

```text
✨ experience_score = mean of per-user `overall` contributions (pure subjective feel)
📊 composite_score  = weighted mean across dimensions (wifi/outlets/seats/temp/coffee)
Card shows ✨ primary; detail shows both + per-dimension bars.

Fixed global weights (Q61): wifi 30% · outlets 20% · seats 20% · temp 15% · coffee 15%.
User-customizable weights: post-MVP.

Temperature mapping (DG73): temp sliders record the raw bidirectional value
(too cold 0 ↔ too hot 100), but the value ENTERING the per-user contribution
and the `dims.temp` sum is the mapped comfort score:
  temp_score = 100 − 2 × |raw − 50|     (raw 50 → 100; raw 0 or 100 → 0)
So `dims.temp.sum/n` is always a mean of comfort scores, consistent with the
bad→good semantics of the other four dimensions. The raw value stays on the
check-in row; the nightly recompute (#146) applies the same mapping when
rebuilding work_stats from check-ins.
```

Social signal hook:

```text
- checkin_likes (user_id + checkin_id) powers the Helpful feed mode. MVP sorts
  `likes_count DESC, visited_at DESC, id DESC`; the opaque cursor carries that
  deterministic tuple. A versioned daily time-decayed snapshot is deferred to #140.
- A tunable social_weight parameter (default 0 at launch) can fold likes into the
  per-checkin contribution before it reaches work_stats. This leaves design space
  for "liked check-ins carry more weight" without a future schema change.
- Likes never affect the cafe score while social_weight = 0; turning it up is an
  explicit product decision, not the default.
```

#### Repeat check-in weighting (same user, same cafe)

A user checking in 20 times must not outweigh 20 different users. Design:

```text
1. Per-user contribution = weighted average of THEIR OWN non-deleted check-ins at that cafe.
   Weight by recency rank: w_i = 0.6^(rank_from_newest)
     newest = 1.0, previous = 0.6, before that = 0.36 ...
   → latest visit dominates (state changes), history smooths, spam caps out.
   Optional: multiply each check-in by (1 + social_weight * normalized_likes)
   when social_weight > 0. Default is 0, so likes do not affect the score at launch.
2. Cafe-level value = UNWEIGHTED mean of per-user contributions.
   → 1 user = 1 vote, regardless of check-in count.
3. Incremental write path (on each check-in):
   a. Load user's prior non-deleted check-ins at this cafe (index hit, few rows)
   b. Compute old_contribution and new_contribution in app code
   c. Existing user at cafe: dims.sum += (new - old), n unchanged
      New user at cafe:      dims.sum += new,        n += 1
   d. Policies: user's LATEST non-deleted check-in is their authoritative answer;
      adjust policy counts by (new answer - old answer)
   e. Single UPDATE cafes SET work_stats = ... WHERE id = ...
4. Edit a check-in → recompute that user's contribution from remaining rows.
5. Soft-delete a check-in (set deleted_at) → recompute from remaining rows and hide
   its photos from cafes.gallery via the source field.
6. Nightly cron on VPS: full recompute of all work_stats from scratch
   (drift correction; cheap at MVP scale, local resources free).
```

### Auth — Supabase

```text
Providers: Apple OAuth + Google OAuth (no email/password — no email infra)
Sessions: Supabase SSR cookies (@supabase/ssr)
OAuth redirectTo validation (web/app/auth/actions.ts):
  - Resolve candidates in this order:
      1. `Origin` request header if present and allowed.
      2. `x-forwarded-proto` + `Host` (or first entry of `x-forwarded-host`) request headers if the `Origin` header is absent and they form an allowed origin.
      3. `NEXT_PUBLIC_SITE_URL` (always allowed if configured).
  - Accept only exact canonical `host` values in the allowlist (with non-default port):
      * host of NEXT_PUBLIC_SITE_URL (always allowed, used as fallback)
      * comma-separated entries in NEXT_PUBLIC_ALLOWED_HOSTS
        (supports host[:port], https://host, or //host)
      * localhost / 127.0.0.1 / [::1] (any port) when no allowlist is configured
  - Only http: and https: schemes are accepted.
  - If the request origin is disallowed, fall back to NEXT_PUBLIC_SITE_URL.
Mutating route CSRF protection (web/lib/security/origin.ts, Issues #208, #218):
  - Every mutating route handler (POST, PATCH, PUT, DELETE) verifies origin via requireSameOrigin(request).
  - Checks Sec-Fetch-Site (rejects cross-site), Origin header against request host / NEXT_PUBLIC_ALLOWED_HOSTS, and falls back to Referer header if Origin is omitted.
  - Requests with neither Origin nor Referer headers (and not marked cross-site) are permitted to maintain compatibility for non-browser / server-to-server HTTP clients.
  - If rejected, immediately returns `403 { "error": "forbidden_origin", "message": "cross-origin request forbidden" }`.
Proxy: web/proxy.ts refreshes the session only when a Supabase session cookie
  is present; uses getSession() to avoid the unconditional user-validation
  round-trip that getUser() forces on every request.
Route handlers: verify session via supabase.auth.getUser() before any Postgres write
Profiles row: upserted in Postgres on first login (auth callback); on failure
  the user is signed out and redirected to /?auth=error&reason=profile_upsert
Anonymous sessions (DG76): Supabase anonymous sign-in issues a session on
  first visit — anonymous users get a profiles row like any user, so
  navigation recording, the navigation→check-in prompt, and local drafts all
  work pre-login. Upgrading to Apple/Google links the same account (no data
  loss). Rate limits treat an anonymous session as a per-session user.
  Privilege split: anonymous sessions cover navigation recording, the
  prompt, drafts, and rate-limit identity only — publishing and photo
  upload still require a provider-linked (Apple/Google) account
  (DG39/DG59/DG66 unchanged).
No email infra, no magic links.
```

### Map — Apple MapKit JS

```text
Library: MapKit JS 5.7+ via CDN (next/script, strategy="afterInteractive")
React wrapper: mapkit-react v1.16+ (React 19 compatible)
Token: server-generated JWT (Apple Developer key), served via /api/mapkit-token
Color scheme: follows app theme (light/dark), runtime toggle
Requires: Apple Developer Program ($99/yr) — user will purchase
```

MapKit JS capabilities used:

```text
- Map rendering (full-screen, dark mode)
- Custom annotations (coffee-cup marker, status dot)
- Clustering (clusteringIdentifier)
- User location tracking
- Text search (mapkit.Search) — current creation + external-search contract
- Geocoding (mapkit.Geocoder) — reserved for the deferred map-tap/manual flow (map-creation-entry slice, #136)
```

**CoffeeMode maintains its own POI database.** MapKit renders and assists search; it does not replace the cafes table. Custom marker: existing coffee-cup design (brown circle, white cup), status dot (open/closed); category variants post-MVP.

### Google Places API (retained)

```text
Usage: cafe creation import + POI enrichment + external search results (not rendering)
Calls: server-side, ALWAYS via the POI cache service below (API key lives there only)
Endpoints:
  - Place Search (Nearby/Text) — external search results list
  - Place Details — enrich imported cafe (photos, hours)
  - Place Autocomplete — search box during import flow
Session tokens: used for autocomplete billing optimization
Dedupe: google_place_id unique index; existing cafe → show it + prompt to check-in
```

### POI cache service (Cloudflare Workers + D1 + KV)

Independent, reusable POI microservice — separate from the Next.js app, so any future service can reuse it and Google billing is cached once for everyone.

```text
poi.coffeemode.app (Cloudflare Worker)
  KV  — hot cache: raw Google Places responses (TTL ~7d)
  D1  — normalized POI store (warm cache, durable):
        place_id, source (google|apple), name, lat, lng, address,
        types, business_status, hours_json, photo_refs, fetched_at
  Upstream — Google Places API (New), field masks to minimize billing

Endpoints (all require POI_SERVICE_TOKEN header):
  GET  /poi/:place_id            fetch/enrich one POI
                                 (KV hot → D1 fresh → Google API → backfill both)
  POST /poi/resolve              {maps_share_url} → POI (creation import path)
  GET  /poi/search?q&lat&lng&r   search STORED POIs: name match + Worker-side
                                 haversine distance sort (powers default search)
  GET  /poi/search/external?q... live Google text search; cache usable results
  POST /poi/external             persist browser-selected Apple MapKit refs

Hosting: Cloudflare workers.dev subdomain first; custom domain
      (poi.coffeemode.app) once domain setup lands. D1 + KV both on free plan.

Auth: shared secret header (POI_SERVICE_TOKEN). Service-to-service only;
      never called from the browser.

Apple POI: MapKit has no server-side Places API for this app. apple_poi_id
      references from MapKit JS client searches are POSTed here for storage;
      the Next.js browser boundary accepts Apple results only. Google live
      search results are cached by GET /poi/search/external.

Next.js integration: /api/places/* route handlers call the POI service
      instead of Google directly. Google/Apple Maps link import →
      POST /poi/resolve; Google provider search → GET /poi/search/external;
      Apple provider search → browser MapKit JS → POST /poi/external.
```

### Image pipeline — image-service Worker + sharp

```text
Upload flow:
  1. Client → Next.js /api/images/upload (Supabase session)
       Body: { size: number }  // REQUIRED, positive integer, <= MAX_UPLOAD_BYTES
  2. Next.js → image-service Worker /v1/images/upload (service token)
       Body: { size: number }  // REQUIRED, positive integer, <= MAX_UPLOAD_BYTES
  3. Worker returns presigned R2 PUT URL for original/{uuid}.webp
  4. Client PUTs the WebP original directly to R2

Processing:
  1. Client → Next.js /api/images/complete (Supabase session + target id + optional `isCover` flag)
  2. Next.js → image-service Worker /v1/images/complete (service token)
  3. Worker verifies original exists and returns:
       - presigned GET URL for original/{uuid}.webp
       - presigned PUT URL for original/{uuid}.webp (to overwrite with capped version)
       - presigned PUT URLs for card/{uuid}.webp and thumbnail/{uuid}.webp
  4. Next.js (sharp on VPS) downloads original, generates:
       - original: downsize if >4096px on longest side, re-encode WebP q80
       - card:     400x300 cover, WebP q80
       - thumbnail: 200x200 cover, WebP q80
  5. Next.js PUTs original (capped), card, and thumbnail back to R2 and updates:
       cafes.gallery / checkins.photos JSONB
  6. If `isCover` is true on a `cafe` target, `cafes.cover` is set to the `card` key
     (client opt-in at creation or cover edit; otherwise the field is left unchanged)

Authorization for /api/images/complete:
  - `cafe` target: allowed only when the user is the cafe's `created_by`.
  - `checkin` target: allowed only when the user owns the checkin (`checkins.user_id`).
    The photo is stored in `checkins.photos` and auto-merged into the parent cafe's
    `gallery` (attributed via `by`/`at`/`source`) without requiring cafe ownership.

Photos on the creation/check-in write paths (issue #86):
  - `POST /api/cafes` and `POST /api/checkins` accept `photo_ids` (imageUuids
    from /api/images/upload), never StoredImage payloads.
  - The server pre-checks each id's upload intent (issue #33 binding),
    processes the image (steps 3-4 and the R2 writes of step 5 above)
    before opening the write transaction, and derives StoredImage itself:
    R2 keys, dimensions from sharp, `by` = the caller, `at` = now,
    `source` = the new check-in.
  - Intents are single-use and consumed inside the creation transaction; a
    foreign, expired, or replayed id aborts the whole write (400
    invalid_photos, no oracle on which id or why).
  - Cap: 6 photos per check-in (DG68; amends the earlier 10).

Auth:
  - Browser: Supabase session cookie
  - Next.js ↔ image-service: shared IMAGE_SERVICE_TOKEN (server-side only)
  - image-service ↔ R2: R2 S3 API credentials (Worker secret)

Storage: Cloudflare R2 public bucket + CDN custom domain
  Keys: original/{uuid}.webp, card/{uuid}.webp, thumbnail/{uuid}.webp

R2 metadata (coffeemode pattern):
  httpMetadata:  { contentType: image/webp }
  customMetadata: { userId, uploadDate, targetType, targetId }

DB record: JSONB entries in cafes.gallery / checkins.photos (no separate table)
  { id, original, card, thumbnail, w, h, by, at, source }

Reference pipelines: our_village (multi-size, temp→final, URLSet),
  image-service Worker (metadata shape)
```

### Rendering strategy

```text
SPA-feel single page. The map page IS the app; no tab bar, no navigation.

/ (single page):
  Full-screen Apple Map
  + floating top bar (logo, search, avatar)
  + bottom sheet, 3 states (Google Maps style):
      PEEK  — no cafe selected; horizontal swipe cards of nearby cafes
              (~85% width, snap) with compact characteristic icons
              (wifi, outlets, stay limit, and other available work facts)
              and a low-contrast Work-score watermark numeral (DG43)
      HALF  — selected cafe preview (cover carousel + name + both scores,
              Navigate / Check in / Share, and top facts)
      FULL  — complete detail backed by real data (work profile, hours,
              gallery, paginated non-deleted check-ins)
              map still visible ~15% at top
  + FAB (add cafe; composing works logged-out from a local draft,
              sign-in is required at publish — DG39)
  + URL sync: opening the first cafe from / pushes one /cafes/[id] entry;
              changing cafe or HALF/FULL state replaces that entry;
              Back collapses the selection session to / without history spam
  Search = overlay panel (own results + "search Google/Apple Maps" external list)
  Check-in = drawer over the sheet
  Onboarding = one-time overlay (first visit only)

At `1024px` and wider, desktop uses the same selected-cafe and URL state but
renders a 380px cafe-list sidebar plus a second left column — the detail
panel sits immediately right of the sidebar, and the map fills the remaining
width (DG42). Smaller viewports use the mobile sheet; PEEK/HALF/FULL snap
states are mobile-only.

The map-independent discovery controller accepts CafeSummary[] plus selected state.
A thin home-page adapter loads the existing nearby-cafes API; MapKit bindings and
unified search stay in their own slices. CafeSummary must expose a card cover.
FULL requires a public, unauthenticated, paginated cafe check-in read contract rather than
permanent fixtures. It offers Newest (default — DG113) and Helpful modes;
Kimi K3 designs the control.
Both modes use server-issued, mode-bound opaque cursors with 20 check-ins per page,
never offset pagination. Helpful orders by `likes_count DESC, visited_at DESC,
id DESC`; Newest orders by `visited_at DESC, id DESC`. Each cursor contains its
mode and the last row's full ordering tuple. Likes may move a check-in between
requests, so MVP pagination is best-effort and clients deduplicate by check-in id.
A daily time-decayed, versioned ranking snapshot is a separate V2 feature (#140).

Refresh and pagination use stale-while-revalidate behavior: keep the last
successful content, show an inline error and Retry beside the failed section,
and never replace real content with fake cards. Initial loading may use the
design-system skeleton.

MVP public cafe/check-in DTOs render the author as “A nomad” and omit internal
author identifiers (`CheckIn.user_id` and `StoredImage.by`). Named identity after
explicit opt-in is a V2 feature tracked in #139, not part of #133.

Mobile downward gestures step FULL → HALF → PEEK. Close and browser Back clear
selection directly to PEEK. Only the handle/header drags the sheet; detail content
owns vertical scrolling and hands a downward pull back to the sheet at scroll-top.
The sheet and desktop drawer are non-modal and do not trap focus. Cafe selection
focuses the detail heading; Close restores focus to the source cafe
card when it still exists. Reduced-motion users get immediate snap/drawer state
changes without transition animation.

Scores stay honest: PEEK carries the Work score as a large low-contrast
watermark numeral with its exact value (DG43) alongside compact work
characteristics, HALF introduces both composite Work and Experience scores
side by side, and FULL explains their dimensions.
Every available value shows its respondent count; missing dimensions render as
"Not enough check-ins" and are never coerced to zero.

Kimi K3 owns the final visual and interaction composition for each new
user-visible UI slice. Product behavior may be specified before that artifact,
but UI implementation and visual acceptance cannot start without it. For the
discovery surface Kimi decides exact iconography, score hierarchy, and the
placement of Navigate / Check in / Share across HALF and FULL; PEEK stays
scan-oriented.

/cafes/[id] (SSR → map app — DG124):
  Deep link / SEO / share landing that BECOMES the app.
  First paint is the server-rendered public shell (DG105/DG106: full
  semantic HTML, no client JS needed) — crawlers, AI search, and link
  previews see exactly this. After load, the page hydrates in place into
  the map app: the map materializes behind the content and the shell
  becomes the FULL sheet (same cafe data, visually continuous); dragging
  down steps FULL → HALF → PEEK and reveals the map (DG14/DG15 gesture
  contract applies). There is no DeepLinkBanner and no separate app
  entry — the drag-down gesture itself is the way into the map.
  A missing cafe returns a real 404 (DG19/DG111): "Back to discover" plus
  a recovery block "附近还有这些咖啡馆" listing nearby cafes relative to
  the GONE cafe's last known location, each linking to its /cafes/[id]
  page. We already know where the gone cafe was, so this block never
  requests the user's geolocation (DG112).
  If an in-app detail fetch discovers the cafe is missing, clear the
  selection, replace the current URL with `/`, return to PEEK, and show a toast.

  URL scheme (DG104):
    - Canonical public URL: /cafes/[id] — stable, id-based, never changes
      when a cafe is renamed. Stability is what citations and AI search
      engines reward.
    - /cafes/[id] IS the app entry (DG124): first paint is the SSR shell,
      then the page hydrates into the map app with this cafe at FULL.
      The earlier /?cafe=[id] entry mechanism is retired.
    - /search?q=&city=&filter_* shareable but noindex; /profile noindex.
    - One canonical URL per cafe, permanently (DG110): locale never enters
      the URL — not at MVP, not later. UI language follows the user via
      cookie/Accept-Language content negotiation; hreflang annotations
      (x-default → the canonical URL) carry language targeting. Shared
      links never split into per-locale SEO identities.

  SEO & AI-search readiness (DG105):
    - Full semantic HTML in the first response (headings, address as text)
      — the public shell needs no client JS.
    - JSON-LD CafeOrCoffeeShop: name, address, geo, aggregateRating from
      experience_score (count = n_checkins).
    - Dynamic sitemap.xml listing all live cafes (lastmod from
      work_stats.updated_at); robots.txt allows /cafes/*.
    - llms.txt at the root describing what CoffeeMode is, for AI crawlers.
    - CDN cache for the shell: s-maxage + stale-while-revalidate, TTLs from
      config (DG107) — a viral shared link must not hit Postgres per open.

  Two-part rendering (DG106):
    Part 1 (SSR, crawler-visible): title block, both scores, WorkProfile
      dimension bars, policy consensus, cover + gallery, hours — aggregate
      product data only.
    Part 2 (client API, after load): the check-in feed (notes = user
      content) — fetched from the public paginated check-in read contract,
      never embedded in the initial HTML. Crawlers and scrapers get the
      aggregate data; raw user content stays behind the API.
    Hydration (DG124): once both parts are up, the page becomes the map
      app — the shell turns into the FULL sheet over the live map. The
      map loads after paint; first-time visitors get content first,
      never a full-screen interruption.

/profile (separate route):
  Avatar, four tabs — My Check-ins (default), 我的咖啡地图, Favorites,
  Search History (DG102/DG103).
```

### Data fetching

```text
Server Components: Postgres query helpers (direct, server-side)
Client Components: TanStack Query v5 → /api/* route handlers
Mutations: useMutation → route handler → Postgres (+ incremental work_stats update)
Cache: Next.js fetch cache (server), TanStack Query cache (client)
Revalidation: on-demand after mutations
```

### Deployment

```text
Primary: VPS (user's own server, public IP)
  - Docker container (next build --output standalone)
  - PM2 or container restart policy
  - Cloudflare CDN proxy (SSL, DDoS, caching)
  - Nightly work_stats recompute via GitHub Actions cron (#146; doubles as the Supabase free-tier keep-alive, 34a)
Fallback: @opennextjs/cloudflare (Workers, Node.js runtime) — post-MVP
Images: Cloudflare R2 + CDN custom domain
Domain: coffeemode.app (or TBD)
```

### Environment config

```text
NEXT_PUBLIC_SUPABASE_URL        -> Supabase project URL (auth, Next.js + browser)
NEXT_PUBLIC_SUPABASE_ANON_KEY   -> client-side anon key (auth only, Next.js + browser)
NEXT_PUBLIC_SITE_URL            -> canonical public origin (no trailing slash); used as safe OAuth redirectTo
NEXT_PUBLIC_ALLOWED_HOSTS       -> optional comma-separated allowlist for additional OAuth redirectTo hosts
DATABASE_URL                    -> Supabase Postgres pooled connection string (Next.js server-only, sslmode=require); migrations use the session/direct connection (decision 34a)
GOOGLE_PLACES_API_KEY           -> POI Worker only (never in Next.js)
POI_SERVICE_URL                 -> POI Worker URL (workers.dev now, custom domain later)
POI_SERVICE_TOKEN               -> shared secret, Next.js → POI Worker
IMAGE_SERVICE_URL               -> image-service Worker URL
IMAGE_SERVICE_TOKEN             -> shared secret, Next.js → image-service Worker
R2_ACCOUNT_ID                   -> image-service Worker (R2 S3 signing)
R2_ACCESS_KEY_ID                -> image-service Worker (R2 S3 token secret)
R2_SECRET_ACCESS_KEY            -> image-service Worker (R2 S3 token secret)
R2_BUCKET_NAME                  -> image-service Worker ("cafemode")
R2_PUBLIC_URL                   -> image-service Worker (CDN base, no trailing slash)
NEXT_PUBLIC_R2_PUBLIC_URL       -> Next.js, optional drift guard; host must match R2_PUBLIC_HOST in web/lib/images/constants.ts (single source, issue #40)
APPLE_MAPKIT_TEAM_ID            -> Apple Developer team
APPLE_MAPKIT_KEY_ID             -> MapKit JS key
APPLE_MAPKIT_PRIVATE_KEY        -> .p8 private key (server-side)
```

## Product capabilities

### Positioning

```text
CoffeeMode = the coworking review platform for digital nomads.
Google Maps tells you a cafe is 4.5 stars.
CoffeeMode tells you if you can sit there with a laptop for 4 hours:
wifi, outlets, seats, temperature, coffee, max stay.
That data exists nowhere else. It is the product.
```

### Priority tiers

```text
Tier 1 (MVP core):
  A. Discovery — map + swipe cards + bottom sheet detail
  B. Creation — add cafe = first check-in (Google/Apple link import + provider search)

Tier 2 (MVP, requires login):
  C. Check-in (打卡) — sliders + policies + note + photos, like toggle, soft delete
  D. Search & filter — city search + nomad filters (wifi/outlets/seats/temp/coffee/overall/max_stay/open_now)

Tier 3 (Post-MVP):
  - Xiaohongshu link import (best-effort, semi-automatic)
  - Favorites / collections
  - Personalized Work Score ("your" weighted dimensions)
  - Owner claims, social features, contribution scoring
  - Daily time-decayed Helpful ranking snapshots (#140)
```

### Check-in (打卡) system

```text
Dimensions (sliders 0-100, continuous integer — no snapped steps (DG60);
  `overall` is required per check-in (DG40), the
  other five are optional — at least one dimension is encouraged, not forced):
  wifi, outlets, seats, temp, coffee, overall
  - temp is bidirectional: too cold ↔ too hot, ideal at the midpoint;
    the value entering aggregation is mapped (temp_score = 100 − 2×|raw−50|,
    see §Aggregation) (DG73)

Policies (chip select, optional per check-in):
  max_stay: unlimited | 3h | 2h | 1h | peak | unknown
  "unknown" is a first-class answer — honest data beats forced guesses.

Note: optional free text, 500 chars max, public immediately (DG67).
  Moderation lever at MVP: a Report overflow item on feed cards; no queue.

Rules:
  - Multiple check-ins per cafe allowed (state changes over time), but at
    most 1 per cafe per user per 24h — further same-day visits edit the
    existing check-in (DG64; enforced via the universal rate limiter, DG74)
  - No restriction: no navigation required before checking in, no geofence
    or presence verification at MVP (DG65)
  - Repeat visit: prompt "Same as last time?" → [same] pre-fills last scores
    (user adjusts if changed). Repeats are weighted by recency, they don't
    stack. Offered only when the last check-in is <90 days old (DG63).
  - Write integrity: client sends an idempotency key (UUID per drawer open);
    server enforces uniqueness so retries never double-record (DG61)
  - Editing a check-in updates values only; recency weighting always keys
    off the original visited_at (DG62)
  - Composing works logged-out (scores, policies, note, locally staged
    photos); publish requires sign-in via a sheet offering all configured
    providers (Apple + Google, DG66). Photo UPLOAD requires auth: presigned
    URLs are issued only to authenticated sessions, so logged-out drafts
    hold photos locally until sign-in (DG59).
  - Photos upload on selection (progress overlay on the thumbnail, user keeps
    composing); submit is instant. Orphan uploads (never referenced by a
    saved check-in) are swept by the R2 lifecycle rule (DG59).
  - Feedback: button morphs to ✓ + micro coffee-steam animation + toast.
    Restrained, memorable, no confetti. (Detailed visual design → Kimi)
  - Check-in photos go to checkins.photos AND auto-merge into cafes.gallery
    (attributed with by/at and source={type:"checkin",id}). No curator approval at MVP.
  - Soft delete: set checkins.deleted_at. Deleted check-in photos are hidden from
    cafes.gallery but remain in checkins.photos for audit/recompute.
  - Like toggle on a check-in: update checkin_likes and denormalized checkins.likes_count.
    FULL exposes Newest (default — DG113) and Helpful modes with opaque cursor
    pagination; Helpful sorts by likes_count, visited_at, then id descending.

Navigation → check-in prompt (ClassPass-style; revised DG76–DG92):
  1. User taps "导航" → navigations row + Google/Apple Maps deep link.
     Works for anonymous sessions too (DG76).
  2. On a LATER day — earliest the next day (DG78; amends the old
     "next visit, >30min" trigger): bottom slide-up card with the cafe's
     cover thumbnail (DG86):
     "有去 {cafe} 喝一杯吗？" [有去！] [还没去] [不去了]  (DG92)
     - 有去！ → opens the check-in drawer with the warm caption
       "来打个卡，帮其他 nomad 种草避雷吧！" (DG92)
     - 还没去 → closes for now; re-ask rules below (DG91)
     - 不去了 → permanently resolves; there is no × close button (DG81)
  3. Prompt queue (DG91): a generic per-user prompt-queue service
     (web/lib/prompt-queue — reusable by future prompt features, not
     nav-specific logic coupled into the component).
     - Eligibility: unresolved, < 3 months old (DG83), and either never
       asked or last_asked_at ≥ 1 day ago.
     - One prompt per session, most recent eligible first; 还没去
       increments ask_count, stamps last_asked_at, and sends the item to
       the BACK of the queue — it becomes eligible again after ≥ 1 day;
       an item dequeued at an ineligible moment is simply re-queued.
     - Max 2 re-asks (ask_count ≤ 2), then auto-resolves.
  4. Any check-in at that cafe auto-resolves the pending navigation (DG79).
     Outcomes (visited / wont_go / not_yet / auto) are stored on the row for
     the navigate→visit funnel (DG80).
  5. Auto-collapse to pill after 8s untouched.
```

### Cafe creation flow (= first check-in)

```text
Entry: FAB button. Composing works logged-out: link-import analysis, scores,
policies, note, and photos are kept as a local draft (photos staged locally),
and Google/Apple sign-in is required only at Publish (DG39). Fully anonymous
publishing is not allowed — every write stays session-bound for rate limiting
and abuse control; "A nomad" anonymity is display identity only.
Creating a cafe IS checking in for the first time — one record pair
(cafes row + checkins row with is_creation=true).

Required on creation:
  name, location, ≥1 photo, review note, overall slider,
  max_stay (1 tap — our differentiating data)
Optional: dimension sliders, hours, price range, description

Maps-link import pre-fills the available provider fields: name, address,
location, and provider reference. Google photos and hours remain in the POI
cache for later enrichment; this creation slice does not copy them into the
cafe record. The user adds the required photo, review + sliders + policies.
(The existing Vite flow already does paste→preview→resolve→create; the
rewrite upgrades it into a HALF-sheet preview + review step.)

Creator display: cafe shows "added by {creator}" — ANONYMOUS by default
("A nomad"); creator can opt in to display later.

Entrances:
  1. Maps link import (one-tap, no form feel):
     a. Paste a Google or Apple Maps share link
     b. Server resolves → normalized POI (Google Place Details, or Apple share-link data)
     c. Show HALF-sheet preview pre-filled (name, address, location, provider reference)
     d. User adds their review + sliders → [添加到 CoffeeMode ✓]
     e. Dedupe: google_place_id / apple_poi_id exists → "已存在" + prompt to check in instead
  2. Provider search:
     a. Search Google Maps through the POI service, or Apple Maps through MapKit JS
     b. Select a result → persist the external POI → use the same preview + first-check-in step
  MapKit map-tap creation and a free-form manual form are deferred; they are not
  creation entry points in the current MVP surface.

No per-field confirmation forms. Pre-fill → adjust if needed → save.
Hours from Google stay in the POI cache for later enrichment; the current
creation slice does not auto-fill cafe hours or provider photos.
Offline: creation is disabled; show OfflineBanner and no mutation queue.
```

### External POI references

```text
CoffeeMode POI = authoritative record in cafes table
External references (optional, for enrichment):
  - google_place_id: link to Google Places (unique, dedupe key)
  - apple_poi_id: link to Apple Maps POI
  - (future) xiaohongshu_note_id: link to XHS post

Navigation deep links:
  - Google Maps: https://www.google.com/maps/dir/?api=1&destination={lat},{lng}
  - Apple Maps: https://maps.apple.com/?daddr={lat},{lng}
  - User chooses preferred navigation app (or detect platform)
```

### Search

```text
Two search modes:

1. Nearby (map / current viewport)
   - Radius: 10 km max, centered on user location or map center.
   - Source: own cafes from Postgres (PostGIS distance sort) + saved POIs from
     POI service. Dedupe by place_id; a created cafe always wins over its raw POI.

2. City search + nomad filters (not geo-radius search)
   - Scope: current city (or city picked by user). An omitted city resolves
     from the Cloudflare `CF-IPCity` header mapped against the curated
     launch-city list (ISO alpha-2 + IATA metro, DG50) kept in `web/config/`;
     fallback chain header-city → country match → global default. An explicit
     `city=` that matches no known city returns 400, never a silent
     re-anchor (DG128).
   - Text query: name FTS on own cafes and saved POIs.
     - Search-as-you-type starts at 3 characters, 400ms debounce (DG44/DG47).
     - Suggestion rows: top 10 only, rendered under the search bar; no
       pagination, no "next page" (DG46).
     - Submit (Enter / search button) shows the results view; plotting results
       on the map belongs to map-discovery-integration (DG46).
     - Keyboard contract: Enter submits, Esc clears the query and dismisses
       suggestions (DG56).
     - Empty query shows a hint line only — no recents/history (DG55).
   - Filters:
     - dimension minima: wifi, outlets, seats, temp, coffee, overall (0-100 thresholds)
     - max_stay: unlimited | 3h | 2h | 1h | peak
     - open_now: boolean (default OFF — DG53)
     - future: price_range, policy consensus, work_score threshold
     - Active filters render as removable chips above the result list (DG54).
     - Filter state is session-scoped; the selected city persists per the
       storage rules (DG51).
     - When a policy filter (max_stay) is active, cafes with
       unknown/insufficient consensus are excluded; the UI shows a capsule
       hint with the excluded count ("N hidden — no data yet") (DG127).
   - Distances are from the user location when known, otherwise from city
     center and labeled as such (DG58).
   - Weak local results (< 3 matches) or empty → prompt "Search Google /
     Apple Maps" (DG49)
   - Every search result item carries an explicit `source`: `coffeemode` |
     `stored_poi` | `google` | `apple`, so results can be grouped/labeled by
     origin (DG130). Live Google results are wired through the POI service in
     a follow-up slice; the current backend returns stored sources only plus
     the weak-results flag.

External search (on demand):
  Google: POI service live Places search → results shown AND stored in D1
  Apple:  MapKit JS client search → refs POSTed to POI service
  → every external search enriches the reusable POI store (billing + flywheel)
  → only food/cafe-category POIs are persisted to D1; unrelated places
    (ATMs, clinics, etc.) are shown but never cached (DG52)

Distance search on D1: SQLite has no spatial index, but Worker-side haversine
  scan is fine at city scale (thousands of POIs). Escape hatch: if a region's
  saved POIs exceed ~50K, mirror hot POIs into Postgres PostGIS.

Search is a growth flywheel: every miss becomes a potential new cafe.
Deep-linkable: /search?q=...&city=...&filter_wifi=... (SSR for shareability);
  live filter changes use history replace, never push (DG48)
Filter UX: thumb-friendly surface, designed in theme-preview before implementation.
```

### Onboarding & city model

```text
Global product, current-city only (no "home city" concept).
Launch: ~10 cities where specialty coffee culture is strong — Singapore,
Tokyo, Seoul, Taipei, Shanghai, Bangkok, Hong Kong, Melbourne, Berlin,
London (DG50). City codes: ISO 3166-1 alpha-2 country code + IATA
metropolitan code (e.g. SG/SIN, JP/TYO, KR/SEL, TW/TPE, CN/SHA, TH/BKK,
HK/HKG, AU/MEL, DE/BER, GB/LON). Schema supports any city; new cities are
added by seeding the city table OR auto-created at runtime when a user's
geolocation resolves outside every known city (DG121) — no schema change
either way; runtime-created rows derive their codes from the same
ISO/IATA scheme via reverse geocoding. The curated launch-city list in
`web/config/` (CF-IPCity mapping, DG128) mirrors this DG50 seed — when a
city is added or renamed, both are updated in the same change.

First visit to /:
  1. IP geolocation → detect country/city (via Cloudflare CF-IPCity, DG128)
  2. Welcome card: detected city + [开启定位] + city picker + skip —
     rendered immediately over the live map, non-modal (DG114)
  3. Allow → locate, save location; Skip → the IP-detected city when one
     was detected, else default Singapore; the manual locate button stays
     available either way (DG116)
  4. One-time: localStorage flag for anonymous visits; for logged-in users
     profiles.onboarded is authoritative — the card never returns on any
     device (DG122)

  Located outside every known city → the city row is created at runtime
  and becomes current_city; the user is told they are the first nomad in
  {city} and encouraged to leave the first check-in to help the next one
  (DG121). Wrong IP-city correction is the city picker alone — no extra
  "not here?" control (DG115).

First visit via deep link (/cafes/[id], /search?q=):
  Content first, never a full-screen interruption for a user who arrived
  with intent: /cafes/[id] lands on the SSR shell and hydrates into the
  map app at FULL sheet (DG124). No welcome card, no banner — the locate
  button is the only geolocation surface (DG112).

Storage:
  Non-logged-in: localStorage (current_city, last lat/lng, onboarded, last_visit)
  Logged-in: profiles.current_city + last_location + last_seen_at + onboarded
  On login: merge localStorage → profiles
```

### Location permission contract (global — DG112)

```text
The OS location-permission prompt fires ONLY after an explicit user tap on
a locate control (onboarding [开启定位], the map locate button). It never
fires on page load, on error or empty states, or on any deep-link/SSR
surface — including the 404 recovery block, which lists cafes near the gone
cafe's known location and needs no user geolocation at all (DG111).
Every location-using feature ships a no-permission fallback: IP-detected or
default city plus the manual city picker / map pan. Denied permission is a
normal state, not an error.

The contract gates the OS prompt, not the UI: the first-visit welcome card
may render at load with the permission primary button — tapping it is the
explicit gesture (DG118). After an OS-level denial the browser will not
re-prompt; the locate button is the only re-entry, and a tap while denied
shows a one-time toast pointing to system settings (DG117).

Map behavior on grant (DG119/DG120): the map recenters on the user with
one motion.slow beat ONLY if the user has not panned since the card
appeared; if they have panned, the blue dot simply appears — the user's
expressed spatial intent wins. The dot then persists for the session, and
re-tapping the locate button recenters on it. Offline grants behave the
same: the card dismisses and the map recenters; only nearby content
follows the global offline treatment (DG123).
```

### PWA & sharing

```text
PWA: manifest + standalone display mode + icons + one unified service worker.
      See ADR-0003 for the minimal, performance-first service-worker design.
      Offline mutation queue is intentionally out of MVP (use banner instead).
Share: Web Share API primary; copy-link is always a visible action, and inside
       WeChat (UA detection) a copy-link popover replaces the share sheet
       (day-one WeChat support — DG109).
OG meta: cafe cover as og:image on /cafes/[id] (flat fallback card when no
       cover); og:description carries the overall score only plus a curiosity
       hook — copy owned by docs/design/seo-sharing-v1.md §4 (DG108).
```

## Phases

### Phase 1: Scaffold + Auth

```text
1. Initialize Next.js app in web/
2. Tailwind v4 + HeroUI v3 + theme tokens + next-intl (en/zh)
3. Supabase auth clients + Postgres db helpers
4. web/proxy.ts for session refresh
5. Apple + Google OAuth login flow, profiles upsert
6. Root layout, theme provider (next-themes), HeroUI <Toast.Provider>
7. Verify: dev server, build, auth round-trip
```

### Phase 2: Map + Discovery integration

The reusable discovery-sheet core (card list, PEEK/HALF/FULL states, and URL state
machinery) is a parallel slice and may use fixtures or API data before MapKit is
available. This phase covers binding that core to MapKit selection, markers, and
map-driven navigation.

```text
1. MapKit JS integration (mapkit-react), token endpoint
2. Full-screen map with cafe markers + clustering + dark mode
3. Bind the mobile discovery sheet (peek/half/full), desktop sidebar/detail column,
   and horizontal swipe cards to map selection
4. Bind the one-push/then-replace URL state machine and Back-to-collapse behavior
   to map-driven navigation
5. Onboarding overlay (IP detect → location)
6. User geolocation + locate button
```

The `/cafes/[id]` SSR deep-link page remains a parallel `seo-sharing` slice and is not
MapKit-blocked.

### Phase 3: Creation + Images

Implementation sequencing note: the MapKit track and the map-independent creation/check-in
track may proceed in parallel. Map-bound MapKit search and reverse geocoding require
`map-home`; Apple provider search in cafe creation only requires the token and stays
configuration-gated. Google/Apple link import, Google provider search, and check-in surfaces
can be built and tested before Apple Developer credentials are available, once their Kimi K3
artifacts exist. Direct map-pin/manual creation is deferred to `map-creation-entry` (#136).

```text
1. Core creation flow (login gate, Google/Apple link import, provider search)
2. POI cache service available (local `wrangler dev` or deployed) before link import is wired end-to-end
3. Google Maps link import (resolve via POI service → HALF-sheet preview → one-tap add)
4. Apple Maps link import (share-link resolve; map-tap / reverse geocode is the separate `map-creation-entry` slice)
5. Map-bound MapKit search / map-tap creation entry after `map-home` and owner issue #131
6. Image upload pipeline (image-service Worker presigned URLs + sharp on VPS → R2 → gallery JSONB)
7. Dedupe handling (existing place → show + check-in prompt)
8. 10 MB upload cap + R2 lifecycle for orphan objects
```

### Phase 4: Check-in + Work Profile

This is a map-independent feature track. Backend and data-contract work may
proceed in parallel with MapKit integration; each user-visible UI item waits for
its Kimi K3 artifact.

```text
1. Check-in drawer (sliders + policy chips + note + photos)
2. Repeat check-in flow ("same as last time?")
3. Incremental work_stats aggregation + nightly recompute cron (includes social-weight hook)
4. Work profile display (dimension bars + policy consensus)
5. Navigation tracking + ClassPass-style return prompt
6. City search + nomad filters
7. Check-in like toggle + Helpful/Newest cursor-paginated check-in feed
8. Soft delete with gallery photo hiding
9. /profile page (four tabs: My Check-ins default / 我的咖啡地图 / Favorites / Search History)
```

### Phase 5: Polish + Deploy

SEO/share, responsive polish, and performance work are independent of MapKit;
user-visible work still requires its Kimi K3 artifact, and deployment remains
gated by the feature slices and owner infrastructure actions.

```text
1. SEO metadata, Open Graph, share flow
2. Responsive polish (mobile/desktop)
3. Lighthouse optimization
4. Docker + deploy to VPS
5. Worker deploy workflows + wrangler placeholders fixed
6. Cloudflare CDN setup
7. CI/CD pipeline with DB migration runner
```

### Phase 6: Post-MVP

```text
1. Xiaohongshu link import (best-effort)
2. Favorites / collections
3. Personalized Work Score (user-weighted dimensions)
4. Owner claims (owner_id), admin panel
5. Marker category variants
6. Data migration from old Java backend
7. Opt-in named public author identity for cafe creators/check-ins (#139)
8. Daily time-decayed Helpful ranking snapshots (#140)
```

### Rate limiting (universal — DG74)

```text
One rate-limiting mechanism covers ALL API routes and script/automation
entry points (migrations runner, nightly recompute, orphan sweep, etc.).

Config: a single `web/config/rate-limits.yaml` — per-route/per-script
limits (requests, window, scope). Scope is per-user when authenticated,
per-IP otherwise. Code never hardcodes limits; adding or tuning a limit
is a config edit, not a code change.

Implementation: in-memory token bucket keyed through an LRU map inside the
Next.js process (e.g. a thin wrapper over `lru-cache`), enforced via one
middleware/helper every route and script calls. In-memory is correct at
MVP scale (single VPS container); the config schema + enforcement
interface are the contract, so swapping the store for Redis/Upstash under
multi-instance scale is a config change, not a redesign. The existing
Postgres-backed token bucket (issue #23, `RATE_LIMIT_BACKEND`) is a valid
store behind this same config/interface — this section standardizes the
config and coverage, it does not mandate replacing that backend; spec 0004
item 33 is satisfied by this mechanism.

Product rules expressed through it: per-user caps on image
upload/complete and POI resolve/search; 1 check-in per cafe per user per
24h (DG64 — enforced as a windowed existence check at the domain layer,
registered in the same YAML so all limits live in one place); auth
attempts.

Search endpoints get a per-IP `search` bucket: 30/min, 100/hour, 200/day
(multi-window); hitting any limit fires an alert via Better Stack (owner
action pending) alongside Cloudflare observability (DG129). Values'
canonical home is `web/config/rate-limits.yaml`.
```

### Configuration (universal — DG107)

```text
Product parameters live in config files, never hardcoded or scattered
through code. This applies to EVERY feature.

- `web/config/rate-limits.yaml` — all rate limits (DG74).
- `web/config/app.yaml` — everything else: CDN cache TTLs
  (s-maxage/stale-while-revalidate per route), search parameters
  (min 3 chars, 400ms debounce, top-10, weak<3), prompt-queue parameters
  (≥1 day re-ask, max 2 re-asks, 3-month expiry), pagination sizes,
  photo caps, note length, etc.

Code reads config through typed helpers (`web/lib/config.ts`); changing a
parameter is a config edit with a typed schema check, not a code change.
Specs name the parameter and its default; the YAML owns the live value.
```

## Edge cases

```text
- MapKit JS requires window — client component + next/script CDN load
- MapKit token JWT must be server-generated (private key never exposed)
- Supabase SSR cookies: `web/proxy.ts` refreshes the session only when a Supabase session cookie is present; route handlers verify the session via `getUser()` before any Postgres write
- Postgres credentials server-side only; client NEVER queries Postgres directly
- Every /api write verifies Supabase session before touching Postgres
- R2 S3 credentials live only in the image-service Worker; Next.js uses presigned URLs; credentials never reach the browser
- image-service token: server-side only; never exposed to browser
- sharp is a native addon — must be in Docker image (node:slim + libvips)
- Google Places session tokens: single-use, 3-minute window
- PostGIS: create extension postgis on the Supabase project (one-time, SQL editor)
- Apple OAuth: requires services ID + return URL config; redirect flow on mobile
- work_stats concurrent writes: single-row UPDATE acceptable at MVP scale;
  nightly recompute corrects any drift
- Deep link first visit: SSR shell hydrates into the map app at FULL sheet; never a full-screen modal, no banner (DG124)
- Location permission: OS prompt only after an explicit user tap, never on load/error/deep-link surfaces; every location feature has a no-permission fallback (§Location permission contract — DG112)
- Check-in soft delete: set deleted_at; recompute work_stats; hide photos from gallery
- Like toggle: idempotent upsert on checkin_likes; keep checkins.likes_count in sync
- Image upload cap: 10 MB max in presigned PUT; R2 lifecycle cleans orphan original/ objects
- maps_share_url validation: only known Google/Apple Maps hosts before proxying
- Search radius cap: nearby is 10 km; city search has no geo radius
- Rate limiting: universal mechanism + `rate-limits.yaml` (see §Rate limiting — DG74)
```

## Tests / acceptance criteria

```text
- next dev starts without errors
- next build completes with zero TypeScript errors
- Apple + Google OAuth login works end-to-end
- Map renders with cafe markers from Postgres
- Dark mode toggles map + UI simultaneously
- Discovery: mobile peek → half → full and desktop sidebar/detail column share
  selection state, one-push/then-replace URL sync, and Back-to-collapse behavior
- PEEK shows compact work-characteristic icons and the Work-score watermark; HALF shows both scores; FULL uses
  real cafe detail and Helpful/Newest cursor-paginated non-deleted check-ins
- MVP public cafe/check-in DTOs render “A nomad” and omit internal author identifiers
- Mobile sheet dismissal and scroll/drag handoff follow the DG14-DG15 contract
- Helpful uses the DG16 ordering tuple; refresh/pagination failures preserve prior content with inline Retry
- Discovery is non-modal with source-focus restoration and immediate reduced-motion state changes
- Desktop discovery starts at 1024px; smaller viewports use the mobile sheet
- Missing in-app cafes return to `/`/PEEK with a toast; direct SSR links return 404
- Every new user-visible UI slice has an approved Kimi K3 design artifact before implementation
- /cafes/[id] is server-rendered (view-source shows content)
- Image upload produces 3 sizes in R2 with correct metadata
- Google Maps + Apple Maps link import → HALF-sheet preview → one-tap create (cafes + checkins rows)
- Duplicate google_place_id / apple_poi_id → "exists" flow, no second cafe
- Check-in stores slider scores 0-100 + policies; work_stats updates incrementally and excludes soft-deleted rows
- Repeat check-in pre-fills via "same as last time?" flow
- Check-in like toggle updates likes_count and the Helpful feed signal
- Soft-deleted check-in hides its photos from cafes.gallery
- Navigation → ClassPass-style prompt on next visit
- Session-refresh proxy refreshes Supabase tokens only when a Supabase session cookie is present
- Nearby search capped at 10 km; city search supports nomad filters (wifi/outlets/seats/temp/coffee/overall/max_stay/open_now)
- Image upload enforces 10 MB cap
- All UI copy goes through next-intl (en + zh)
- Lighthouse performance >= 80 on cafe detail page
- `npm run lint` passes with zero errors
- Vitest unit tests pass (stats aggregation math with social-weight hook, utils, API routes)
- Playwright e2e (post-MVP): login → browse → create → check-in flow
```
