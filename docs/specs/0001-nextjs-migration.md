# 0001. Next.js Full-Stack Rewrite

## Goal

Rewrite CoffeeMode as a full-stack Next.js application — **the coworking review platform for digital nomads**. CoffeeMode's moat is data Google Maps doesn't have: wifi quality, power outlets, seat comfort, temperature, coffee quality, minimum spend, and max stay policy — all crowd-sourced through 打卡 (check-ins).

Drop the Java Spring Boot backend entirely. CoffeeMode owns its POI database; Google Places and Apple Maps are external references and import sources, never authoritative.

This is a rewrite, not a migration. The old Vite SPA (`coffeemode-frontend/`) and Java backend are reference material only.

## Status

Accepted (revised 2026-08-07 — Supabase auth-only split, self-hosted Postgres data layer, image-service Worker, slider scoring, creation-as-first-checkin)

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
            route.ts        # POI cache service resolve proxy (Google Maps link → POI)
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
Supabase         → AUTH ONLY (Apple + Google OAuth, sessions)
Self-hosted VPS  → ALL DATA (Postgres + PostGIS)
```

- The client never talks to Postgres. All data access goes through Next.js route handlers (server-side), which verify the Supabase session first.
- No Supabase RLS needed for data (data never leaves the server). Supabase anon key is used only for auth flows.
- Postgres connection: standard `pg` Pool (server-side only). PostGIS enabled via `create extension postgis`.

#### Tables (4 total — deliberately minimal)

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
  gallery         jsonb default '[]',     -- [{id, original, card, thumbnail, w, h, by, at}]
  opening_hours   jsonb,                  -- {mon:{open,close},...} + hours_source
  price_range     smallint,               -- 1-4
  google_place_id text,
  apple_poi_id    text,
  created_by      uuid references profiles(id),
  owner_id        uuid references profiles(id),  -- post-MVP owner claim
  work_stats      jsonb default '{}',     -- incremental aggregation cache (see below)
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index idx_cafes_location on cafes using gist (location);
create index idx_cafes_name_fts on cafes using gin (to_tsvector('simple', name));
create unique index idx_cafes_gplace on cafes (google_place_id) where google_place_id is not null;  -- dedupe
create index idx_cafes_city on cafes (city);

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
  min_spend   text,                       -- none | drink | s5 | s10 | s10plus
  max_stay    text,                       -- unlimited | 3h | 2h | 1h | peak
  note        text,
  photos      jsonb default '[]',         -- [{id, original, card, thumbnail, w, h, by, at}]
  visited_at  timestamptz default now(),
  created_at  timestamptz default now()
);
create index idx_checkins_cafe on checkins (cafe_id, created_at desc);
create index idx_checkins_user_cafe on checkins (user_id, cafe_id, created_at desc);

-- 4. navigations: drives the ClassPass-style "did you visit?" prompt
create table navigations (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid references cafes(id) on delete cascade,
  user_id     uuid references profiles(id),
  resolved    boolean default false,
  created_at  timestamptz default now()
);
create index idx_nav_pending on navigations (user_id) where resolved = false;
```

Notes:

```text
- No cafe_images table: image metadata lives in cafes.gallery / checkins.photos JSONB
- No cafe_likes table: favorites are post-MVP
- No votes/policies tables: everything folds into the check-in row
- Favorites/collections, follows, owner claims: post-MVP (owner_id column reserved)
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

`cafes.work_stats` is an aggregation cache updated incrementally on each write (no heavy SQL rollups, no materialized views). Local VPS CPU/RAM/disk are free to use.

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
    "min_spend": { "none": 4, "drink": 7, "s5": 1 },
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
```

#### Repeat check-in weighting (same user, same cafe)

A user checking in 20 times must not outweigh 20 different users. Design:

```text
1. Per-user contribution = weighted average of THEIR OWN check-ins at that cafe.
   Weight by recency rank: w_i = 0.6^(rank_from_newest)
     newest = 1.0, previous = 0.6, before that = 0.36 ...
   → latest visit dominates (state changes), history smooths, spam caps out.
2. Cafe-level value = UNWEIGHTED mean of per-user contributions.
   → 1 user = 1 vote, regardless of check-in count.
3. Incremental write path (on each check-in):
   a. Load user's prior check-ins at this cafe (index hit, few rows)
   b. Compute old_contribution and new_contribution in app code
   c. Existing user at cafe: dims.sum += (new - old), n unchanged
      New user at cafe:      dims.sum += new,        n += 1
   d. Policies: user's LATEST check-in is their authoritative answer;
      adjust policy counts by (new answer - old answer)
   e. Single UPDATE cafes SET work_stats = ... WHERE id = ...
4. Delete/edit a check-in → recompute that user's contribution from remaining rows.
5. Nightly cron on VPS: full recompute of all work_stats from scratch
   (drift correction; cheap at MVP scale, local resources free).
```

### Auth — Supabase (auth only)

```text
Providers: Apple OAuth + Google OAuth (no email/password — no email infra)
Sessions: Supabase SSR cookies (@supabase/ssr)
Route handlers: verify session via supabase.auth.getUser() before any Postgres write
Profiles row: upserted in Postgres on first login (auth callback)
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
- Search autocomplete (mapkit.SearchAutocomplete) — creation + external search
- Geocoding (mapkit.Geocoder) — reverse geocode for manual creation
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
  POST /poi/external             store externally-searched POIs (Google live
                                 results, Apple MapKit refs) — everything
                                 searched becomes reusable

Hosting: Cloudflare workers.dev subdomain first; custom domain
      (poi.coffeemode.app) once domain setup lands. D1 + KV both on free plan.

Auth: shared secret header (POI_SERVICE_TOKEN). Service-to-service only;
      never called from the browser.

Apple POI: MapKit has no server-side Places API. apple_poi_id references
      from MapKit JS client searches are POSTed here for storage, so the
      POI store covers both ecosystems and cafes can link to either.

Next.js integration: /api/places/* route handlers call the POI service
      instead of Google directly. Google Maps link import → POST /poi/resolve.
```

### Image pipeline — image-service Worker + sharp

```text
Upload flow:
  1. Client → Next.js /api/images/upload (Supabase session)
  2. Next.js → image-service Worker /v1/images/upload (service token)
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
    `gallery` (attributed via `by`/`at`) without requiring cafe ownership.

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
  { id, original, card, thumbnail, w, h, by, at }

Reference pipelines: our_village (multi-size, temp→final, URLSet),
  coffeemode-image worker (metadata shape)
```

### Rendering strategy

```text
SPA-feel single page. The map page IS the app; no tab bar, no navigation.

/ (single page):
  Full-screen Apple Map
  + floating top bar (logo, search, avatar)
  + bottom sheet, 3 states (Google Maps style):
      PEEK  — horizontal swipe cards of nearby cafes (~85% width, snap)
      HALF  — selected cafe preview (cover carousel + name + actions + top facts)
      FULL  — complete detail (work profile, hours, gallery, check-ins)
              map still visible ~15% at top
  + FAB (add cafe, login-gated)
  + URL sync: sheet HALF/FULL → history.replaceState(/cafes/[id])
              back button collapses sheet; deep links re-open the sheet
  Search = overlay panel (own results + "search Google/Apple Maps" external list)
  Check-in = drawer over the sheet
  Onboarding = one-time overlay (first visit only)

/cafes/[id] (SSR):
  Deep link / SEO / share landing only.
  Same cafe content, rendered server-side with a lightweight
  "Open in map" banner → first-time visitors get a lighter onboarding
  (content first, never a full-screen interruption).

/profile (separate route):
  Avatar, my cafes, my check-ins.
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
  - Nightly work_stats recompute cron (local resources)
Fallback: @opennextjs/cloudflare (Workers, Node.js runtime) — post-MVP
Images: Cloudflare R2 + CDN custom domain
Domain: coffeemode.app (or TBD)
```

### Environment config

```text
NEXT_PUBLIC_SUPABASE_URL        -> Supabase project URL (auth, Next.js + browser)
NEXT_PUBLIC_SUPABASE_ANON_KEY   -> client-side anon key (auth only, Next.js + browser)
DATABASE_URL                    -> Self-hosted Postgres connection string (Next.js server-only)
GOOGLE_PLACES_API_KEY           -> POI Worker only (never in Next.js)
POI_SERVICE_URL                 -> POI Worker URL (workers.dev now, custom domain later)
POI_SERVICE_TOKEN               -> shared secret, Next.js → POI Worker
IMAGE_SERVICE_URL               -> image-service Worker URL
IMAGE_SERVICE_TOKEN             -> shared secret, Next.js → image-service Worker
R2_ACCOUNT_ID                   -> image-service Worker (R2 S3 signing)
R2_ACCESS_KEY_ID                -> image-service Worker (R2 S3 token secret)
R2_SECRET_ACCESS_KEY            -> image-service Worker (R2 S3 token secret)
R2_BUCKET_NAME                  -> image-service Worker ("cafemode")
R2_PUBLIC_URL                   -> image-service Worker + Next.js (CDN base, no trailing slash)
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
wifi, outlets, seats, temperature, coffee, min spend, max stay.
That data exists nowhere else. It is the product.
```

### Priority tiers

```text
Tier 1 (MVP core):
  A. Discovery — map + swipe cards + bottom sheet detail
  B. Creation — add cafe = first check-in (Google import + manual + MapKit search)

Tier 2 (MVP, requires login):
  C. Check-in (打卡) — sliders + policies + note + photos
  D. Search & filter — text search, dimension filters (wifi fast, no min spend, ...)

Tier 3 (Post-MVP):
  - Xiaohongshu link import (best-effort, semi-automatic)
  - Favorites / collections
  - Personalized Work Score ("your" weighted dimensions)
  - Owner claims, social features, contribution scoring
```

### Check-in (打卡) system

```text
Dimensions (sliders 0-100, each optional — but ≥1 slider required per check-in):
  wifi, outlets, seats, temp, coffee, overall

Policies (chip select, optional per check-in):
  min_spend: none | drink | s5 | s10 | s10plus | unknown
  max_stay:  unlimited | 3h | 2h | 1h | peak | unknown
  "unknown" is a first-class answer — honest data beats forced guesses.

Rules:
  - Multiple check-ins per cafe allowed (state changes over time)
  - No restriction: no navigation required before checking in
  - Repeat visit: prompt "Same as last time?" → [same] pre-fills last scores
    (user adjusts if changed). Repeats are weighted by recency, they don't stack.
  - Feedback: button morphs to ✓ + micro coffee-steam animation + toast.
    Restrained, memorable, no confetti. (Detailed visual design → Kimi)
  - Check-in photos go to checkins.photos AND auto-merge into cafes.gallery
    (attributed with by/at). No curator approval at MVP.

Navigation → check-in prompt (ClassPass-style):
  1. User taps "导航" → navigations row + Google/Apple Maps deep link
  2. On NEXT site visit (not immediately): bottom slide-up card
     "你上次导航去了 {cafe}，去过了吗？" [打卡 ✓] [没去]
  3. Trigger: unresolved navigation, >30min since, max 1 prompt per session,
     auto-collapse to pill after 8s
```

### Cafe creation flow (= first check-in)

```text
Entry: FAB button (login required)
Creating a cafe IS checking in for the first time — one record pair
(cafes row + checkins row with is_creation=true).

Required on creation:
  name, location, ≥1 photo, review note, overall slider,
  min_spend, max_stay (2 taps — our differentiating data)
Optional: dimension sliders, hours, price range, description

Google import pre-fills most required fields: name, address, location,
photos, hours come from the share link — user only adds review + sliders
+ policies. (The existing Vite flow already does paste→preview→resolve→
create; the rewrite upgrades it into a HALF-sheet preview + review step.)

Creator display: cafe shows "added by {creator}" — ANONYMOUS by default
("A nomad"); creator can opt in to display later.

Paths:
  1. Google Maps import (one-tap, no form feel):
     a. Paste link OR pick from Places autocomplete
     b. Server resolves → Place Details
     c. Show HALF-sheet preview pre-filled (name, address, location, photos, hours)
     d. User adds their review + sliders → [添加到 CoffeeMode ✓]
     e. Dedupe: google_place_id exists → "已存在" + prompt to check in instead
  2. Apple Maps / MapKit search: same pre-fill + confirm pattern
  3. Manual: tap map → reverse geocode fills address → same confirm pattern

No per-field confirmation forms. Pre-fill → adjust if needed → save.
Hours from Google: auto-fill, hours_source='google'; user edit → 'manual' (never overwritten).
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
Default search (e.g. "coffee") = own cafes + saved POIs, merged by distance:
  1. Own cafes — self-hosted Postgres, name FTS + PostGIS distance sort
  2. Saved POIs — POI service GET /poi/search (D1 + Worker haversine)
     Includes POIs never created as cafes → each is a creation candidate
  Merge rule: dedupe by place_id; a created cafe always wins over its raw POI.
  Empty/weak local results → prompt "Search Google / Apple Maps"

External search (on demand):
  Google: POI service live Places search → results shown AND stored in D1
  Apple:  MapKit JS client search → refs POSTed to POI service
  → every external search enriches the reusable POI store (billing + flywheel)

Distance search on D1: SQLite has no spatial index, but Worker-side haversine
  scan is fine at city scale (thousands of POIs). Escape hatch: if a region's
  saved POIs exceed ~50K, mirror hot POIs into Postgres PostGIS.

Search is a growth flywheel: every miss becomes a potential new cafe.
Deep-linkable: /search?q=... (SSR for shareability)
Nomad filters: [📶 wifi fast] [💰 no min spend] [⏱ unlimited stay] [🔌 outlets]
```

### Onboarding & city model

```text
Global product, current-city only (no "home city" concept).
MVP: Singapore only; schema supports any city.

First visit to /:
  1. IP geolocation → detect country/city
  2. Welcome card: detected city + [开启定位] + city picker + skip
  3. Allow → locate, save location; Skip → default Singapore + manual locate button
  4. One-time (localStorage flag; on login also persisted)

First visit via deep link (/cafes/[id], /search?q=):
  Content first. Lightweight bottom banner "☕ CoffeeMode — [打开地图探索] [✕]".
  Never a full-screen interruption for a user who arrived with intent.

Storage:
  Non-logged-in: localStorage (current_city, last lat/lng, onboarded, last_visit)
  Logged-in: profiles.current_city + last_location + last_seen_at
  On login: merge localStorage → profiles
```

### PWA & sharing

```text
PWA (MVP): manifest + standalone display mode + icons. No service worker.
Share: Web Share API primary, copy-link fallback.
OG meta: cafe cover as og:image on /cafes/[id].
```

## Phases

### Phase 1: Scaffold + Auth

```text
1. Initialize Next.js app in web/
2. Tailwind v4 + HeroUI v3 + theme tokens + next-intl (en/zh)
3. Supabase auth clients + Postgres db helpers
4. Apple + Google OAuth login flow, profiles upsert
5. Root layout, theme provider (next-themes)
6. Verify: dev server, build, auth round-trip
```

### Phase 2: Map + Discovery

```text
1. MapKit JS integration (mapkit-react), token endpoint
2. Full-screen map with cafe markers + clustering + dark mode
3. Bottom sheet (peek/half/full) + horizontal swipe cards
4. URL sync (replaceState ↔ sheet state, back button)
5. Onboarding overlay (IP detect → location)
6. /cafes/[id] SSR deep link page
7. User geolocation + locate button
```

### Phase 3: Creation + Images

```text
1. FAB + creation flow (login gate)
2. POI cache service (Worker + D1 + KV) deployed first — creation depends on it
3. Google Maps link import (resolve via POI service → HALF-sheet preview → one-tap add)
4. MapKit search import + manual (map tap → reverse geocode)
5. Image upload pipeline (image-service Worker presigned URLs + sharp on VPS → R2 → gallery JSONB)
6. Dedupe handling (existing place → show + check-in prompt)
```

### Phase 4: Check-in + Work Profile

```text
1. Check-in drawer (sliders + policy chips + note + photos)
2. Repeat check-in flow ("same as last time?")
3. Incremental work_stats aggregation + nightly recompute cron
4. Work profile display (dimension bars + policy consensus)
5. Navigation tracking + ClassPass-style return prompt
6. Search + nomad filters
7. /profile page
```

### Phase 5: Polish + Deploy

```text
1. SEO metadata, Open Graph, share flow
2. Responsive polish (mobile/desktop)
3. Lighthouse optimization
4. Docker + deploy to VPS
5. Cloudflare CDN setup
6. CI/CD pipeline
```

### Phase 6: Post-MVP

```text
1. Xiaohongshu link import (best-effort)
2. Favorites / collections
3. Personalized Work Score (user-weighted dimensions)
4. Owner claims (owner_id), admin panel
5. Marker category variants
6. Data migration from old Java backend
```

## Edge cases

```text
- MapKit JS requires window — client component + next/script CDN load
- MapKit token JWT must be server-generated (private key never exposed)
- Supabase SSR cookies: middleware refreshes session on each request
- Postgres credentials server-side only; client NEVER queries Postgres directly
- Every /api write verifies Supabase session before touching Postgres
- R2 S3 credentials live only in the image-service Worker; Next.js uses presigned URLs; credentials never reach the browser
- image-service token: server-side only; never exposed to browser
- sharp is a native addon — must be in Docker image (node:slim + libvips)
- Google Places session tokens: single-use, 3-minute window
- PostGIS: create extension postgis on self-hosted Postgres (one-time)
- Apple OAuth: requires services ID + return URL config; redirect flow on mobile
- work_stats concurrent writes: single-row UPDATE acceptable at MVP scale;
  nightly recompute corrects any drift
- Deep link first visit: banner onboarding, never full-screen modal
```

## Tests / acceptance criteria

```text
- next dev starts without errors
- next build completes with zero TypeScript errors
- Apple + Google OAuth login works end-to-end
- Map renders with cafe markers from Postgres
- Dark mode toggles map + UI simultaneously
- Bottom sheet: peek → half → full with URL sync and back-button collapse
- /cafes/[id] is server-rendered (view-source shows content)
- Image upload produces 3 sizes in R2 with correct metadata
- Google Maps link import → HALF-sheet preview → one-tap create (cafes + checkins rows)
- Duplicate google_place_id → "exists" flow, no second cafe
- Check-in stores slider scores 0-100 + policies; work_stats updates incrementally
- Repeat check-in pre-fills via "same as last time?" flow
- Navigation → ClassPass-style prompt on next visit
- All UI copy goes through next-intl (en + zh)
- Lighthouse performance >= 80 on cafe detail page
- `npm run lint` passes with zero errors
- Vitest unit tests pass (stats aggregation math, utils, API routes)
- Playwright e2e (post-MVP): login → browse → create → check-in flow
```
