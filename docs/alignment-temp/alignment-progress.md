# Alignment Progress — Next.js Rewrite Grill

## Round 1 — confirmed

| # | Decision | Answer |
|---|----------|--------|
| Q1 | Project structure | New `web/` directory, single package, no monorepo |
| Q2 | Migration strategy | Full rewrite (not migration), incremental, styles redesigned |
| Q3 | Backend | Drop Java Spring Boot entirely, Next.js full-stack |
| Q4 | PR baseline | Merge feat/agent-harness-and-docs-system to main first |
| Q5 | Deployment | Cloudflare ecosystem (specific products pending Q14 research) |
| Q6 | Testing | Vitest + React Testing Library + Playwright (per recommendation) |
| Q7 | Auth + DB | Supabase Auth + Postgres; user has own MongoDB hosted (deferred) |

## Round 2 — confirmed

| # | Decision | Answer |
|---|----------|--------|
| Q8 | Data layer | ~~All Supabase (Postgres + Auth + Storage)~~ — superseded by Round 5: self-hosted Postgres for app data, Supabase Auth only |
| Q9 | Deployment target | VPS (Docker + next standalone) + Cloudflare CDN proxy. Fallback: @opennextjs/cloudflare Workers |
| Q10 | Rewrite scope | ALL features rewritten. Product capabilities defined in later grill rounds |
| Q11 | Google Maps/Places | Keep all capabilities. Google Places API via Next.js route handlers |
| Q12 | Data migration | Production data migration deferred |
| Q13 | Branch strategy | Merge current branch to main, then continue updating on new branch |
| Q14 | Tech stack review | Confirmed: single Next.js monolith, no split needed. VPS + Cloudflare CDN recommended |

## Round 2b — Image pipeline — confirmed

| # | Decision | Answer |
|---|----------|--------|
| Q15 | Image storage | Cloudflare R2 (not Supabase Storage) |
| Q16 | Image processing | Server-side sharp on VPS (not Workers — CPU limits too tight) |
| Q17 | Image pipeline | our_village pattern: one upload → multiple sizes (original/capped, card, thumbnail; all WebP) — superseded by final spec |
| Q18 | R2 metadata | Keep coffeemode pattern: customMetadata { userId, uploadDate, targetType, targetId }; imageType dropped as redundant |
| Q19 | Image serving | R2 public bucket + Cloudflare CDN custom domain. No Worker proxy needed for reads |
| Q20 | Upload auth | Supabase Auth (replaces JWT). Rate limiting via Next.js middleware or Cloudflare WAF |

## Round 3 — Product capabilities — confirmed

| # | Decision | Answer |
|---|----------|--------|
| Q21 | Core journey priority | A (Discovery) first. B/C/D all require login |
| Q22 | Data model | Structured columns + JSONB + arrays. PostGIS. Indexes for future |
| Q23 | Map + Theme | Apple MapKit JS (全部迁移). HeroUI v3 modern theme. No retro |
| Q24 | Creation flow | Google/Apple Maps link import + Google/Apple provider search. Map-pin/manual creation deferred. Login required |
| Q25 | Review/Check-in | Fact-based 打卡 (wifi_ok, good_temp, long_stay...) + rating. Keep simple |
| Q26 | Auth providers | Apple + Google OAuth only. No email (no email infra) |
| Q27 | Dark mode | Yes! Apple Maps dark + HeroUI dark tokens. Follow system + toggle |
| Q28 | Apple Developer | User will purchase ($99/yr) |
| Q29 | Google Places | KEEP. Own POI database is authoritative. Google/Apple POI = external refs |
| Q30 | Xiaohongshu import | Post-MVP. Best-effort semi-automatic |

### Key product decisions

- CoffeeMode maintains its OWN POI database (cafes table)
- Google Places API retained for import/enrichment (not rendering)
- Apple MapKit JS for rendering + search/geocoding
- External references: google_place_id, apple_poi_id on cafe record
- Navigation tracking → "did you visit?" → check-in prompt (小心思)
- Check-in = 打卡 (not 打分): fact voting + optional rating + note
- Custom map markers (own design, amenity glyphs)

## Round 4 — Design / UX / Feature logic — in progress

| # | Decision | Answer |
|---|----------|--------|
| Q31 | First-open experience | Onboarding: IP → country/city detect → location permission prompt → save location to DB. Skip → default Singapore + manual locate button |
| Q32 | Cafe card / SPA | Compact cards (mobile web space is tight). SPA feel — single page, list pinnable to home. 2026 stunning UI/UX |
| Q33 | Detail hierarchy | Icons for amenities/status. Cover → name+rating → actions → facts → hours → gallery → checkins |
| Q34 | Check-in rules | Multiple check-ins per cafe allowed. Nice animation feedback. No restriction (don't need navigation first) |
| Q35 | Nav→checkin prompt | On next site visit (return), ClassPass-style prompt. Not immediate, not in-page |
| Q36 | Google Place dedup | No duplicates. If exists → show "已存在" + prompt to check-in instead |
| Q37 | Search | Mixed: own results + "Search Google/Apple Maps" button → external results list → import entry |
| Q38 | SPA + deep links | SPA main + /cafes/[id] SSR deep link. Deep link first-visit needs different onboarding (not same as home). Search also has shareable links |
| Q39 | Onboarding scope | Singapore only for MVP. Non-login: localStorage. Login: save to profiles table (home_city, last_location) |
| Q40 | Map markers | Keep existing coffee cup marker style. Can categorize later (post-MVP). Status dot (open/closed) |
| Q41 | Empty states | Approved direction. Avoid vibe-coding aesthetic. i18n from day one |
| Q42 | PWA | Yes — manifest + standalone mode. No Service Worker for MVP |
| Q43 | Share | Web Share API (mobile) + copy link fallback. OG meta with cafe cover as og:image |
| Q38b | Cafe detail UX | Mobile: Google Maps style bottom sheet (peek → half → full); `/cafes/[id]` SSR only for deep links. Desktop was superseded by DG1's sidebar + right detail drawer. |
| Q39b | City concept | No "home_city" — global product, only "current_city". profiles.current_city + last_location |
| Q44 | i18n | English primary + Chinese. next-intl. All copy via t(), no hardcode |
| Q45 | Navigation | No tab bar. Map-first + overlays. Top floating bar + FAB. /profile separate route |
| Q46 | Check-in animation | Button morph ✓ + coffee steam micro-animation + toast. Kimi handles detailed visual design later |
| Q47 | Cafe cards | Compact horizontal (~72px), peek shows 2.5 cards |
| Q48 | Import UX | One-tap natural creation. No per-field confirmation form. Pre-fill → user adjusts if needed → save |
| Q49 | ★ POSITIONING | Digital nomad coworking review platform. Own data Google Maps doesn't have: can work? wifi? min spend/max stay? seat comfort? temperature? |
| Q50 | PEEK cards | Horizontal swipe cards (carousel style), eye-catching, anti-vibe-coding |

## Round 5 — Work profile / data model simplification

| # | Decision | Answer |
|---|----------|--------|
| Q49b | Dimensions | 5 sliders: wifi, outlets, seats/tables, temperature, coffee quality. DROPPED: laptop-friendly (too abstract), noise |
| Q52b | Scoring | All scores = personal subjective slider, stored 0-100 decimal. No 3-state voting |
| — | DB split | Supabase = AUTH ONLY. Data → self-hosted Postgres. Minimize table count |
| — | Policy vs checkin votes | Over-engineered — killed. min_spend/max_stay fold into the checkin itself |
| Q53b | Creation | Creation = first check-in: name/location/photos + review + sliders REQUIRED. No official/creator distinction; owner column later |
| Q55b | Repeat check-in | "Same as last time?" [same / changed→expand]. Repeats replace, don't stack |
| — | Aggregation | Incremental app-side update of cafes.work_stats JSONB on write. No heavy SQL aggregates. Local CPU/RAM free for nightly recompute |

## Round 6 — Final model decisions — confirmed

| # | Decision | Answer |
|---|----------|--------|
| Q51b | Google POI storage | Independent POI cache service: Cloudflare Worker + D1 + KV. Stores all searched Google POIs, reusable by other services. Apple POI refs too (POSTed from MapKit client) |
| Q53c | Creator display | "added by {creator}", anonymous by default ("A nomad"), opt-in display later. Required fields pre-filled from Google share link (existing Vite flow: paste→preview→resolve→create) |
| Q56 | Postgres database | User will self-host on VPS |
| Q57 | Check-in minimum | ≥1 slider required (overall or any dimension). min_spend/max_stay get "unknown" option — honest data over forced guesses |
| Q58 | Composite score | TWO scores: ✨ experience_score (mean of overall) + 📊 composite_score (weighted dimensions) |
| Q59 | Slider default | No default — unmoved slider not recorded (option A) |
| Q60 | Check-in photos | Yes — into checkins.photos AND auto-merge cafes.gallery (attributed). Upload pipeline: image-service Cloudflare Worker (presigned R2 URLs) + Next.js /api/images handlers + sharp on VPS → R2 |
| Q51c | Default search flow | Search bar default = own cafes (self-hosted Postgres PostGIS) + saved POIs (D1 via POI service), merged by distance. D1 distance = Worker haversine (fine at city scale; Postgres PostGIS mirror as documented escape hatch). Miss → "Search Google/Apple" → live results shown AND stored. Every searched POI reusable + creation candidate |
| Q61 | Composite weights | A — fixed global: wifi 30% · outlets 20% · seats 20% · temp 15% · coffee 15% |
| Q62 | POI service hosting | CF account OK for D1/KV (free plan); workers.dev first, custom domain later |
| Q63 | Baseline merge | Approved — merge feat/agent-harness-and-docs-system → main |

## Round 7 — Discovery implementation contract — partial

| # | Decision | Answer |
|---|----------|--------|
| DG1 | Responsive surface | Mobile uses PEEK/HALF/FULL; desktop uses a 380px list sidebar + right detail drawer over the same selection state |
| DG2 | Browser history | First cafe selection pushes one `/cafes/[id]` entry; cafe/height changes replace it; Back collapses the selection session to `/` |
| DG3 | Deep-link ownership | `discovery-sheet` owns client selection/popstate only; `seo-sharing` owns the SSR `/cafes/[id]` route |
| DG4 | Initial state | PEEK starts with `selectedCafeId=null`; a user card tap selects the cafe and opens HALF |
| DG5 | Data boundary | A provider-neutral controller accepts `CafeSummary[]`; a thin home adapter loads the existing cafes API; MapKit and unified search remain separate |
| DG6 | PEEK characteristics | Compact icons expose wifi, outlets, stay limit, and other available place characteristics; Kimi K3 decides exact iconography and composition |
| DG7 | Score hierarchy | Both Work/composite and Experience scores appear from HALF onward; Kimi K3 designs their hierarchy |
| DG8 | Cafe actions | Keep Navigate, Check in, and Share; Kimi K3 decides their HALF/FULL placement; PEEK stays scan-oriented |
| DG9 | FULL data | FULL uses a real public, unauthenticated, paginated feed of non-deleted check-ins, not permanent fixtures; DG11-DG13 resolve modes, pagination, and MVP identity while Helpful ranking remains open |
| DG10 | Sparse data | Show available values with respondent counts; zero-response dimensions say “Not enough check-ins”; never coerce missing data to zero |
| DG11 | FULL feed modes | Offer both Helpful and Newest; Kimi K3 designs the control and its placement; Helpful's ranking formula remains unresolved |
| DG12 | Feed pagination | Use server-issued, mode-bound opaque cursors with 20 check-ins per page; no offset pagination |
| DG13 | MVP author identity | Public cafe/check-in content renders “A nomad” and omits internal author identifiers; named opt-in identity is deferred to V2 issue #139 |
| DG14 | Sheet dismissal | Downward gestures step FULL → HALF → PEEK; Close and browser Back clear selection directly to PEEK |
| DG15 | Gesture ownership | Only the handle/header drags the sheet; content owns scrolling and hands a downward pull back to the sheet only at scroll-top |

All new user-visible UI requires a slice-specific Kimi K3 design artifact before
implementation. Until that artifact exists, exact layout/interaction composition
is an explicit blocker rather than an agent-invented default.

## Decisions log

- 2026-07-31: Architecture pivot from "migrate Vite SPA + keep Java backend" to "rewrite as full-stack Next.js, drop Java"
- 2026-07-31: Supabase chosen as primary data/auth layer
- 2026-07-31: Cloudflare ecosystem for deployment/auxiliary services
- 2026-07-31: VPS + Cloudflare CDN as primary deployment (not Cloudflare-native serverless)
- 2026-07-31: R2 for image storage, sharp on VPS for processing, our_village pipeline pattern
- 2026-07-31: legacy `coffeemode-image` Worker retired; image pipeline becomes presigned R2 URLs via a Cloudflare Worker + Next.js `/api/images/complete` for sharp processing

- 2026-08-03: Data layer split — Supabase AUTH only; self-hosted Postgres for all data (4 tables)
- 2026-08-03: POI cache service (Workers + D1 + KV) as independent reusable microservice
- 2026-08-03: Dual scores (✨ experience + 📊 composite), slider-only scoring, "unknown" policy option
- 2026-08-03: Hermes config — reasoning_effort=max, openrouter provider removed (qwen-coding-plan only)
- 2026-08-19: Discovery behavior DG1-DG10 agreed; exact visual composition delegated to Kimi K3 and required before UI implementation
- 2026-08-20: Discovery behavior DG11-DG15 agreed; Helpful ranking remains open, and V2 opt-in author identity is tracked in #139

## Final tech stack (locked)

```
Frontend + Backend:  Next.js 15+ (App Router, Turbopack), React 19, TS strict
Styling:             Tailwind CSS v4 + HeroUI v3 (custom CoffeeMode theme)
Animation:           Framer Motion (restrained, 2026-elegant)
Map:                 Apple MapKit JS 5.7+ (mapkit-react), dark mode, clustering
Data fetching:       TanStack Query v5 (client), server fetch (SSR)
Database:            Self-hosted Postgres + PostGIS (4 tables: profiles/cafes/checkins/navigations)
Auth:                Supabase Auth only (Apple + Google OAuth, no email)
Image storage:       Cloudflare R2 (S3 API, public bucket + CDN)
Image processing:    sharp on VPS (original + card + thumbnail WebP)
Image upload:        image-service Cloudflare Worker (presigned R2 URLs)
POI cache:           Cloudflare Worker + D1 + KV (poi.coffeemode.app), Google key lives here
Google Places:       via POI service only (never direct from Next.js)
Deployment:          VPS Docker (next standalone) + Cloudflare CDN/proxy
CI:                  GitHub Actions
Testing:             Vitest + RTL (unit), Playwright (e2e), tsc --noEmit
i18n:                next-intl (en primary, zh) from day one
```
