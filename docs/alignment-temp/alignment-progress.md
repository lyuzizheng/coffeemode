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

## Round 7 — Discovery implementation contract — complete

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
| DG9 | FULL data | FULL uses a real public, unauthenticated, paginated feed of non-deleted check-ins, not permanent fixtures; DG11-DG13 resolve modes, pagination, and MVP identity, and DG16 resolves MVP Helpful ranking |
| DG10 | Sparse data | Show available values with respondent counts; zero-response dimensions say “Not enough check-ins”; never coerce missing data to zero |
| DG11 | FULL feed modes | Offer both Helpful and Newest; Kimi K3 designs the control and its placement |
| DG12 | Feed pagination | Use server-issued, mode-bound opaque cursors with 20 check-ins per page; no offset pagination |
| DG13 | MVP author identity | Public cafe/check-in content renders “A nomad” and omits internal author identifiers; named opt-in identity is deferred to V2 issue #139 |
| DG14 | Sheet dismissal | Downward gestures step FULL → HALF → PEEK; Close and browser Back clear selection directly to PEEK |
| DG15 | Gesture ownership | Only the handle/header drags the sheet; content owns scrolling and hands a downward pull back to the sheet only at scroll-top |
| DG16 | Helpful ranking | MVP orders by `likes_count DESC, visited_at DESC, id DESC`; the cursor carries that tuple. A daily time-decayed ranking snapshot is deferred to V2 issue #140 |
| DG17 | Feed failure recovery | Keep the last successful feed while refreshing or paginating; show an inline error and Retry for the failed section; never replace real content with fake cards |
| DG18 | Focus and reduced motion | Discovery is non-modal: selection focuses the detail heading, Close returns focus to the source card, there is no focus trap, and reduced-motion users get immediate state changes |
| DG19 | Missing cafe | A direct SSR deep link returns a real 404 with Back to discover; an in-app miss clears selection, replaces the URL with `/`, returns to PEEK, and shows a toast |
| DG20 | Responsive switch | Desktop sidebar/drawer starts at `1024px`; smaller viewports use the mobile sheet. Kimi K3 validates tablet-landscape composition |

All new user-visible UI requires a slice-specific Kimi K3 design artifact before
implementation. Until that artifact exists, exact layout/interaction composition
is an explicit blocker rather than an agent-invented default.

## Round 8 — Design-artifact grill — complete

Kimi K3 delivered the map-independent slice artifacts (`docs/design/`, issues
#133/#135/#148/#149/#150/#152/#153) and grilled the owner on the decisions made
plus parked judgment items. All ten items ruled (2026-08-21): DG21 explicitly,
DG22–DG30 by owner agreement with the Kimi recommendations.

| # | Decision | Answer |
|---|----------|--------|
| DG21 | Check-in drawer dirty dismiss | Dismissing the check-in drawer with any input (set slider, selected policy chip, note text, staged photo) prompts `Discard this check-in?` with Keep editing / Discard; a pristine drawer closes immediately. Draft persistence stays a V2 candidate. Applied to `docs/design/checkin-system-v1.md` §6 |
| DG22 | Display-font rule | Spec 0002 typography rule amended: display font for page/screen titles, the brand wordmark, and cafe names only — never for data, numbers, or component state labels |
| DG23 | Experience sparkle glyph | Keep the 14px four-point sparkle SVG as functional score iconography; it is not the banned decorative sparkle |
| DG24 | Filter threshold steps | Dimension filters are tri-state segments Any / 60+ / 80+; the API keeps the 0–100 threshold contract |
| DG25 | Modal task surfaces | Confirmed split: filter panel and check-in drawer are modal (focus-contained); the discovery sheet stays non-modal |
| DG26 | Edit-mode dimension removal | Allowed: in edit mode a set slider row carries a small × returning it to unset; composing stays strict. Applied to `docs/design/checkin-system-v1.md` §3.2/§5 |
| DG27 | Offline check-ins | Check-in mutations disabled offline (generalizing spec 0004 §18's creation rule; no mutation queue). Applied to `docs/design/checkin-system-v1.md` §6 |
| DG28 | Nav-prompt timer pause | The 8s auto-collapse pauses on hover/focus/touch; an untouched card still collapses |
| DG29 | Deep-link banner dismissal | Permanent via a `localStorage` flag in the onboarding storage family. Applied in PR #165 (commit 43b0941, `docs/design/seo-sharing-v1.md` §3) |
| DG30 | Profile pagination | `Load more` button at 20 per page; no infinite scroll |

## Round 9 — Discovery-sheet grill — complete except DG-Q1

15-question grill on the discovery-sheet artifact (tech/product/UX). Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG31 | Selection state ownership | The discovery controller owns selection/sheet state; the URL is a derived projection, never re-read except popstate |
| DG32 | Nearby refetch policy | Refetch only on zoom change or ≥1/10-viewport movement, debounced 1s after movement stops; in-flight requests cancelled when the view moves again; no refetch from accidental jiggles |
| DG33 | Coverless cards | PEEK cards and search rows without a cover render a `surface-tertiary` block + cup glyph |
| DG34 | Tiny carousels | Fewer than 3 nearby cafes collapse the PEEK carousel to a static row |
| DG35 | Card tap targets | The whole PEEK card is one tap target (no cover/body split) |
| DG36 | Toast position | Mobile toasts render top-center below the search bar; bottom belongs to sheet/FAB/pill |
| DG37 | Feed mode race | Feed requests are mode-keyed; responses from a deserted Helpful/Newest mode are discarded |
| DG38 | Good-cafe marker emphasis | High-Work-score cafes get a subtle marker emphasis (accent ring), input to the `map-home` artifact; marker variants otherwise remain post-MVP per spec 0001 |
| DG39 | Creation login gate | Composing works logged-out (link analysis, scores, policies, note, locally staged photos); sign-in is required at Publish; fully anonymous publishing rejected (rate-limit/abuse/data-integrity). Specs 0001/0002 amended |
| DG40 | Mandatory overall | The `overall` slider is required per check-in; the other five dimensions stay optional. Spec 0001 amended |
| DG41 | First-run guidance | No filter-specific popup; the one-time onboarding card plus the empty-search hint line carry first-visit guidance |
| DG42 | Desktop detail placement | Cafe detail is a second left column immediately right of the sidebar; the map fills the remaining width; no right-side drawer. Supersedes DG1's "right detail drawer" and DG20's "sidebar/drawer" phrasing (the DG20 breakpoint itself stands). Specs 0001/0002 + discovery-sheet-v1 §7 amended |
| DG43 | PEEK score watermark | The Work score appears in PEEK as a large low-contrast watermark numeral (non-content graphic: ≤8% opacity, `aria-hidden`, single hue, no battery gauge, no multi-hue gradient) plus its exact value in the meta line. Specs 0001/0002 + 0004 §5 (type-ceiling exemption) amended |

Still open: the BottomSheet implementation question (bespoke Framer Motion vs
`react-spring-bottom-sheet`) — Kimi recommends bespoke, owner has not ruled.

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
- 2026-08-20: Discovery behavior DG11-DG15 agreed; V2 opt-in author identity is tracked in #139
- 2026-08-20: Discovery behavior DG16-DG20 agreed; MVP ranking, recovery, accessibility, missing-cafe handling, and the 1024px responsive switch are settled; daily time-decayed ranking is deferred to V2 issue #140
- 2026-08-21: Map-independent Kimi K3 artifacts delivered as Drafts (#133/#135/#148 merged via PRs #161/#164/#163; #149/#150/#152/#153 in PR #165); artifact grill round 8 complete — DG21-DG30 ruled (display-font rule amended in spec 0002, edit-mode dimension unset and offline check-in disable confirmed, sparkle glyph kept, tri-state filters, modal task surfaces, timer pause, permanent banner dismissal, profile load-more)
- 2026-08-21: Artifact grill round 9 (discovery-sheet) — DG31-DG43 ruled; specs amended for mandatory overall slider, draft-then-publish creation, desktop left detail column, and PEEK Work-score watermark; BottomSheet implementation question still open

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
