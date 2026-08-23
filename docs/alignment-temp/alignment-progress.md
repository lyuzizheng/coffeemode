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
| DG29 | Deep-link banner dismissal | Permanent via a `localStorage` flag in the onboarding storage family. Applied in PR #165 (commit 43b0941, `docs/design/seo-sharing-v1.md` §3). (Superseded by DG124 — the banner was abolished; nothing left to dismiss) |
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

The round-9 parked question — BottomSheet implementation (bespoke Framer
Motion vs `react-spring-bottom-sheet`) — was resolved 2026-08-21 as DG75:
owner-delegated, bespoke Framer Motion, plus a universal viewport/safe-area
contract (see the round-11 table).

## Round 10 — Search-filters grill — complete

15-question grill on the search-filters artifact (tech/product/UX). Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG44 | Typing trigger | Search-as-you-type starts at 3 characters |
| DG45 | Merge architecture | Accepted as designed: `/api/search` merges own cafes (Postgres) with saved POIs (D1 via POI service), dedupes by place_id, own cafe wins; D1 haversine scan is fine at city scale with the 50K escape hatch |
| DG46 | Pagination | None. Top-10 suggestion rows under the search bar while typing; submit shows the results view; plotting results on the map belongs to `map-discovery-integration` |
| DG47 | Filter debounce | 400ms against rapid toggling; in-flight refetch superseded by the latest change |
| DG48 | URL updates | Live filter changes use history replace, never push |
| DG49 | Weak threshold | Fewer than 3 local matches triggers the external-search prompt |
| DG50 | Launch cities | ~10 at launch: Singapore, Tokyo, Seoul, Taipei, Shanghai, Bangkok, Hong Kong, Melbourne, Berlin, London; codes = ISO 3166-1 alpha-2 + IATA metro. Amends spec 0001's "MVP: Singapore only" |
| DG51 | State persistence | Filters are session-scoped; the selected city persists per the storage rules |
| DG52 | D1 caching scope | Only food/cafe-category external POIs are persisted; unrelated places are shown but never cached. Spec 0001 §Search amended; narrows Q51b/Q51c's store-all to food/cafe-category |
| DG53 | Open-now default | OFF — nothing is active until the user touches a control |
| DG54 | Active filter chips | Removable chips above results, one per active filter |
| DG55 | Empty query | Hint line only; no recents/history |
| DG56 | Keyboard contract | Enter submits; Esc clears query/dismisses suggestions, closes overlay when empty |
| DG57 | zh filter labels | `Any/60+/80+` → `不限/60+/80+` |
| DG58 | Distance labeling | From user location when known, else from city center labeled as such |

## Round 11 — Check-in system grill — complete

15-question grill on the checkin-system artifact (tech/product/UX), plus one
owner-initiated addition (universal rate limiting). Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG59 | Photo upload timing | Upload-on-select with image+scrim+progress-bar overlay; composing never blocked; submit instant; orphans swept by R2 lifecycle. Photo upload requires auth — presigned URLs are issued to authenticated sessions only; logged-out drafts stage photos locally until the sign-in gate. Spec 0001 amended |
| DG60 | Slider granularity | Continuous integer 0–100, no snapped steps |
| DG61 | Idempotency | Client UUID per drawer open + server-side dedupe; retries never double-record. Spec 0001 amended |
| DG62 | Edit vs recency | Editing updates values only; recency weighting keys off the original `visited_at` |
| DG63 | Same-as-last-time window | Offered only when the last check-in is <90 days old |
| DG64 | Check-in frequency | 1 per cafe per user per 24h; further same-day visits open the existing check-in in edit mode (product behavior, not an error). Enforced via the universal rate limiter (DG74). Spec 0001 amended |
| DG65 | Presence verification | None — no geofence at MVP |
| DG66 | Sign-in gate | Publishing requires sign-in via a sheet offering all configured providers (Apple + Google); staged draft publishes after sign-in without re-entry |
| DG67 | Notes | 500-char hard cap, public immediately; Report-only moderation lever at MVP. Spec 0001 amended |
| DG68 | Photo cap | 6 per check-in (amends the earlier 10 in spec 0001) |
| DG69 | Haptics | Weakest device vibration (`navigator.vibrate(10)`) on first slider touch, in addition to the visual pulse |
| DG70 | Drawer detents | Two detents: opens at content height, draggable to the 92% full-height detent |
| DG71 | Success moment | Re-explained to owner; spec 0002 auto-close sequence stands (button ✓ morph → steam card 900ms → drawer close → toast) |
| DG72 | Edit entry points | Feed-card overflow menu + profile check-in history + an `Edit your check-in` row on the cafe detail when a live check-in exists |
| DG73 | Temperature scale | Bidirectional: too cold ↔ too hot, ideal at midpoint; endpoint captions on the slider row; aggregation maps distance-from-50 → score. Spec 0001 amended |
| DG74 | Universal rate limiting | Owner-initiated: one mechanism for all API routes AND script/automation entry points, configured in a single `web/config/rate-limits.yaml` (per-route limits/window/scope); in-memory LRU token bucket at MVP with Redis/Upstash as a config-level swap; the merged Postgres token bucket (#23) is a valid store behind the same interface. New spec 0001 §Rate limiting |
| DG75 | BottomSheet implementation + safe area | Owner-delegated ("you decide"): bespoke Framer Motion sheet, no third-party library; plus a universal viewport contract — dvh/svh units for sheet geometry, env(safe-area-inset-*) padding on all bottom-anchored surfaces, viewportFit=cover. Spec 0002 §Layout amended; discovery-sheet-v1 §5 and checkin-system-v1 §2 aligned. Also confirmed: DG70 (two drawer detents) and DG71 (success moment) stand as written |

## Round 12 — Navigation-prompt grill — complete

15-question grill on the navigation-prompt artifact (tech/product/UX),
re-explained in plain language at owner request. Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG76 | Anonymous users | The prompt works for anonymous users via Supabase anonymous sign-in — anonymous sessions get a profiles row, navigation recording and drafts work pre-login, upgrading to Apple/Google links the same account. Spec 0001 §Auth amended |
| DG77 | Prompt fetch timing | Lazy query after the map reaches idle — never on the critical render path (overruled Kimi's bootstrap-payload recommendation) |
| DG78 | Prompt timing | Earliest the NEXT DAY after the navigation (amends the old "next visit, >30min" trigger), and the card has three options instead of two-plus-× |
| DG79 | Auto-resolve | Any check-in at that cafe, from any entry point, silently resolves the pending navigation (outcome `auto`) |
| DG80 | Outcome storage | `不去了` permanently resolves; all outcomes (visited / wont_go / not_yet / auto) are stored on the navigations row for the navigate→visit funnel. Spec 0001 table amended (`outcome` column) |
| DG81 | Three options, no close button | No × anywhere. `去过了，打卡！` → check-in drawer; `还没去` closes for now (max 2 re-asks on later days); `不去了` permanently resolves |
| DG82 | Multiple unresolved | Queued — one prompt per session, most recent first |
| DG83 | Expiry | Navigations older than 3 months never prompt (overruled Kimi's 7 days) |
| DG84 | Desktop prompt | Yes — bottom-center over the map, same rules |
| DG85 | FULL sheet interaction | Defer: the prompt renders only when the sheet is at PEEK/HALF |
| DG86 | Cover thumbnail | Yes — the card shows the cafe's 48px cover (overruled Kimi's glyph-only recommendation); owner directive: all design must be visually pleasant |
| DG87 | Copy tone | Owner directive: sweep the wording system — all copy must be 热情真诚 (warm, sincere), cute, with zero commercial/sales feel. New spec 0002 §Copy tone; nav-prompt copy rewritten (`和 {cafe} 见面了吗？`); system-wide sweep of other artifacts is a tracked follow-up |
| DG88 | Pill lifetime | The pill stays until answered — no second timeout |
| DG89 | Entry feedback | No sound, no haptic |
| DG90 | Modal stacking | The prompt defers while any modal task surface is open — never stacks |
| DG91 | Re-ask queue design | `还没去` re-asks ≥ 1 day later, sends the item to the BACK of the queue; an item dequeued at an ineligible moment is re-queued, never dropped; max 2 re-asks confirmed. The queue is a generic per-user prompt-queue service (`web/lib/prompt-queue`) reusable by future features. Owner directive added to AGENTS.md rules: shared behavior is built as segregated, reusable service components — no duplication, no cross-feature coupling. Spec 0001 navigations table gains `ask_count` / `last_asked_at` |
| DG92 | Prompt copy (final) | Headline `有去 {cafe} 喝一杯吗？`; primary `有去！`; on tap the check-in drawer carries the caption `来打个卡，帮其他 nomad 种草避雷吧！`. Supersedes the round-12 nav-prompt wording |
| DG93 | System-wide copy sweep | All artifacts' en/zh copy brought under the DG87 tone principle: warmer zh state lines (`没保存成功，再试试？`, `打卡成功，谢谢分享！`, `打卡还太少啦`, `你好像在 {city} 哦`, `你的咖啡馆都住在这儿`, `这家咖啡馆找不到了`…), friendlier empty-state bodies, spec 0002 NavPrompt catalog row updated, and a §Copy tone caveat added: somber moments (404/errors/deletions) stay quiet — cute never jokes at the user's expense |

## Round 13 — Profile-page grill — complete

10-question grill on the profile-page artifact (question count set by
judgment, per owner). Q1–Q7 agreed as recommended; Q8–Q10 expanded by the
owner. Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG94 | Anonymous sessions on /profile | Anonymous users see the gate, not their data — with an added data-preservation promise (`登录后，你现在的记录都会保留`); the gate offers all sign-in providers |
| DG95 | Avatar/name fallback | Provider avatar → initial circle; provider name → email prefix (before the `@`, never the full email) |
| DG96 | /profile SEO/privacy | `noindex`, SSR per request, never CDN-cached |
| DG97 | Editable fields | Display name (inline, 24 chars) and current city (chip → Select popover) are editable; nothing else |
| DG98 | Account deletion | MVP ships sign-out only; Delete account is V2 — required before any native app (Apple store rule) |
| DG99 | Deleted cafes | Soft-deleted cafes are hidden from 我的咖啡地图; their check-in cards remain in My Check-ins, unlinked and muted |
| DG100 | Like counts | Kept on own check-in cards — the quiet feedback loop that your data helped someone |
| DG101 | App-like navigation | Owner's core concern: the page must navigate like an app, not a website. Entry via 36px avatar in the search bar (mobile) / sidebar top (desktop); /profile pushes exactly one history entry; browser back / iOS swipe / Android back return to the map exactly as left (selection, detent, scroll intact, no refetch); direct-landing fallback goes to `/`; header back-chevron mirrors the gesture |
| DG102 | Tabs + design ambition | Default tab is **My Check-ins** (overruled Kimi's My Cafes default). Four tabs: My Check-ins / 我的咖啡地图 / Favorites / Search History — the latter two designed now, shipping with empty states until their features land (favorites stay post-MVP; search history is client-side only). Owner directive: the page must be design-forward, not an old-school Google Maps profile — artifact §1–§3 recomposed (hero header, cards, atlas framing). Spec 0004 §10/§11 + UI4 amended |
| DG103 | My Cafes zh name | `我的咖啡地图` (My Coffee Map) — owner's pick; if the product later expands beyond coffee, the name is revisited then |

## Round 14 — SEO-sharing grill — DG104–DG113 ruled (Q10 → DG124, see follow-up)

10-question grill on the seo-sharing artifact. Q1–Q9 ruled (DG104–DG113),
with owner expansions; Q10 (DeepLinkBanner dismissal scope) was resolved
after round 15 by redesign — DG124 abolished the banner (see the follow-up
section below). Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG104 | URL mechanism | Canonical `/cafes/[id]` — stable, id-based, never changes on rename; `/search` shareable but noindex; `/profile` noindex; no locale prefixes at MVP. Spec 0001 amended. (The `/?cafe=[id]` app-entry mechanism was later retired by DG124 — `/cafes/[id]` itself hydrates into the map app) |
| DG105 | SEO + AI-search readiness | Owner directive: "design for AI search, design for SEO optimisation". Full semantic HTML without client JS, JSON-LD CafeOrCoffeeShop with aggregateRating from experience_score, dynamic sitemap.xml (lastmod from work_stats.updated_at), robots.txt allowing /cafes/*, `llms.txt` at the root for AI crawlers, CDN-cached shell. Spec 0001 amended |
| DG106 | Two-part cafe page | Owner design: Part 1 = SSR public shell (scores, bars, policies, gallery, hours — aggregate data, crawler-visible, no client JS); Part 2 = check-in feed (user content) loaded client-side from the public API, never in initial HTML — anti-scrape data protection + smaller HTML. The `?feed=newest` SSR links become a client-side toggle. Spec 0001 + artifact amended. (A hydration step was later added by DG124 — after both parts load, the page becomes the map app at FULL sheet) |
| DG107 | Universal configuration | Owner directive: "ensure these contents are configurable, not scattered in codes — apply to all other features". New spec 0001 §Configuration: product parameters (cache TTLs, search params, prompt-queue params, pagination sizes, caps) live in typed config files (`web/config/app.yaml`, `web/config/rate-limits.yaml`), read via helpers; AGENTS.md rule added |
| DG108 | OG preview copy | og:description shows the overall (Experience) score ONLY plus a curiosity hook (`✨ 87 · 23 位 nomad 打卡 — 这里真的适合办公吗？`); og:title = `{name} · {city} — CoffeeMode`; empty-state variant honest (`还没有打卡 — 来当第一个？`) |
| DG109 | WeChat day-1 + big CTA | WeChat is a first-class share target from MVP: copy-link is always a visible action; WeChat UA gets a copy-link popover (`复制链接，发给朋友吧`) instead of a dead native-share call. The SSR page's `Check in` becomes the dominant full-width 56px CTA; Navigate/Share subordinate |
| DG110 | Locale-independent canonical URL | One canonical URL per cafe, permanently: locale never enters the URL — not at MVP, not later. UI language via cookie/Accept-Language content negotiation, hreflang (x-default → canonical URL) for language targeting; shared links never split into per-locale SEO identities. Spec 0001 URL block amended |
| DG111 | 404 recovery block | Missing-cafe 404 gains `附近还有这些咖啡馆`: nearby cafes relative to the GONE cafe's last known location, each linking to its `/cafes/[id]`. Hard constraint: the location-permission prompt never fires there — the gone cafe's location is known, so user geolocation is never needed. Spec 0001 §Rendering + artifact §5 amended |
| DG112 | Global location-permission contract | Owner directive to audit all location-permission UX: the OS permission prompt fires ONLY after an explicit user tap on a locate control; never on page load, error/empty states, or deep-link/SSR surfaces; every location-using feature ships a no-permission fallback (IP/default city + manual picker). New spec 0001 §Location permission contract |
| DG113 | Feed default = Newest | Owner overruled the assistant's Helpful recommendation: the cafe check-in feed opens in Newest (`visited_at DESC, id DESC`); Helpful stays one toggle away. Recorded as an owner override. Spec 0001 feed contract + artifact §2 amended |

## Round 15 — Onboarding grill — DG114–DG123 ruled

10-question grill on `docs/design/onboarding-v1.md` (geolocation
onboarding, #153). All ten ruled, Q8 with a major owner expansion.
Round-14 Q10 was resolved after this round by redesign (DG124 — the
banner was abolished; see the follow-up section below).
Rulings:

| # | Decision | Answer |
|---|----------|--------|
| DG114 | Welcome card timing | The card renders immediately on first visit to `/`, non-modal over the live map (artifact as designed). No delay-until-interaction |
| DG115 | Wrong IP-city correction | The city Select alone; no extra "not here?" link — wrong detection is a low-frequency path |
| DG116 | Skip target city | Skip lands on the IP-detected city when one was detected; Singapore default only when there is no detection. Spec 0001 amended |
| DG117 | Post-denial re-entry | The locate button is the only re-entry after OS-level denial; a tap while denied shows a one-time toast pointing to system settings, never a dead prompt |
| DG118 | Card vs DG112 contract | The DG112 contract gates the OS prompt, not the UI: the welcome card may render at load with the permission primary button — tapping it is the explicit gesture |
| DG119 | Recenter on grant | The 450ms recenter beat happens only if the user has NOT panned since the card appeared; after a user pan the blue dot simply appears — expressed spatial intent wins |
| DG120 | Blue-dot lifecycle | The dot persists for the session; re-tapping the locate button recenters on it (standard map behavior) |
| DG121 | Out-of-coverage geolocation | Owner expansion over the assistant's nearest-launch-city fallback: when geolocation resolves outside every known city, the city row is CREATED in the DB at runtime and becomes current_city; the user is told they are the first nomad in {city} and encouraged to leave the first check-in to help others. Spec 0001 city model amended |
| DG122 | One-time flag across devices | For logged-in users `profiles.onboarded` is authoritative — the card never returns on any device; anonymous visits stay localStorage-scoped. Spec 0001 storage block amended |
| DG123 | Offline grant | An offline first-visit grant still dismisses the card and recenters the map; only nearby content follows the global offline treatment — location is a browser API, not network |

## Round 14 follow-up — DG124 (Q10 resolved by redesign)

Re-examining Q10 (DeepLinkBanner dismissal scope), the owner ruled that
the banner should not exist at all: a shared link should land on the map
itself — the cafe detail at ~FULL, draggable down to reveal the map. The
pending A/B dismissal-scope question is void.

| # | Decision | Answer |
|---|----------|--------|
| DG124 | `/cafes/[id]` hydrates into the map app | First paint stays the SSR public shell (DG105/DG106 crawler, SEO, and anti-scrape properties intact; MapKit loads after paint); once both parts are up, the page hydrates in place — the map materializes behind the content, the shell becomes the FULL sheet, and the DG14/DG15 drag-down gestures step FULL → HALF → PEEK to reveal the map. DeepLinkBanner abolished (Q10 void); the `/?cafe=[id]` app-entry mechanism retired. Amends DG104/DG106; spec 0001 §Rendering/§Onboarding/§Edge cases, spec 0002 component list, seo-sharing-v1 §2/§3/§6/§7, onboarding-v1 §5 amended |

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
- 2026-08-21: Artifact grill round 9 (discovery-sheet) — DG31-DG43 ruled; specs amended for mandatory overall slider, draft-then-publish creation, desktop left detail column, and PEEK Work-score watermark; BottomSheet implementation question later resolved as DG75
- 2026-08-21: Artifact grill round 10 (search-filters) — DG44-DG58 ruled; spec 0001 amended for 3-char/400ms search-as-you-type, top-10 no-pagination suggestions, weak<3 external prompt, food-only D1 caching, session-scoped filters, and a ~10-city launch replacing Singapore-only MVP
- 2026-08-21: Artifact grill round 11 (check-in system) — DG59-DG74 ruled; spec 0001 amended for check-in write integrity (idempotency, edit-recency, 90-day Same window, 24h frequency, 500-char notes, 6-photo cap, bidirectional temperature, multi-provider sign-in gate) and a new universal YAML-configured rate-limiting section covering all APIs and scripts
- 2026-08-21: DG75 — BottomSheet is bespoke Framer Motion (owner-delegated); universal viewport/safe-area contract (dvh/svh, env() insets, viewportFit=cover) added to spec 0002 §Layout; round-9's last parked question closed
- 2026-08-22: Artifact grill round 12 (navigation-prompt) — DG76-DG90 ruled; spec 0001 amended for Supabase anonymous sessions, navigations.outcome column, next-day prompt timing, three-option no-× card, 3-month expiry, and queuing; new spec 0002 §Copy tone (热情真诚, cute, non-commercial); system-wide copy sweep tracked as follow-up
- 2026-08-22: DG91-DG92 — re-ask queue semantics (≥1 day, back-of-queue, re-queue on ineligible dequeue, max 2 re-asks) with a generic reusable `web/lib/prompt-queue` service; AGENTS.md gains the reusable-segregated-components repo rule; nav-prompt copy finalized (有去 {cafe} 喝一杯吗？ / 有去！ / 种草避雷 drawer caption)
- 2026-08-22: DG93 — system-wide copy tone sweep applied across all six design artifacts + spec 0002 (warmer zh state lines, friendlier empty states, somber-moments caveat); DG87 follow-up closed
- 2026-08-22: Artifact grill round 13 (profile-page) — DG94-DG103 ruled; /profile recomposed as a design-forward personal coffee atlas with four tabs (My Check-ins default, 我的咖啡地图, Favorites, Search History), app-like back navigation, anonymous-session gate with data-preservation promise; spec 0004 §10/§11 + UI4 amended
- 2026-08-23: Artifact grill round 14 (seo-sharing), partial — DG104-DG109 ruled: URL scheme (canonical /cafes/[id], /?cafe= app entry), SEO+AI-search readiness (JSON-LD, sitemap, llms.txt), two-part cafe page (SSR shell + client-loaded feed), universal typed config (web/config), OG overall-only + hook, WeChat day-1 with big Check-in CTA; Q7-Q10 pending owner
- 2026-08-23: Artifact grill round 14 (seo-sharing) completed except Q10 — DG110-DG113 ruled: locale-independent canonical URL made permanent (cookie/Accept-Language + hreflang x-default), 404 nearby-cafes recovery that never prompts for location, global location-permission contract (explicit-tap-only OS prompt, no-permission fallback everywhere), feed default = Newest (owner override of the Helpful recommendation); Q10 (DeepLinkBanner dismissal scope) still pending owner
- 2026-08-23: Artifact grill round 15 (onboarding) — DG114-DG123 ruled: immediate non-modal welcome card, Select-only wrong-city correction, Skip lands on the IP-detected city, denied re-entry via locate button + one-time settings toast, DG112 gates the OS prompt not the card UI, no recenter after user pan, session-persistent blue dot, out-of-coverage geolocation auto-creates the city with a first-nomad invitation (owner expansion), profiles.onboarded authoritative across devices, offline grant still dismisses
- 2026-08-23: DG124 — round-14 Q10 resolved by redesign: /cafes/[id] first paint stays the SSR shell, then hydrates in place into the map app at FULL sheet with drag-down to the map; DeepLinkBanner abolished and the /?cafe= app entry retired (amends DG104/DG106). Grill program fully complete; path clears for implementation (#146 work-profile is the only READY slice)

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
