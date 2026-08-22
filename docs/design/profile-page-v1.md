# Profile Page — Design Artifact v1

- Slice: `profile-page` (issue #152)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — copy tone sweep per DG87/DG93;
  grill round 13 rulings DG94–DG103)
- Base: `docs/design/discovery-sheet-v1.md` (card language, segmented
  control), `docs/design/checkin-system-v1.md` (edit drawer)
- Specs: `docs/specs/0001-nextjs-migration.md` §Rendering strategy
  (`/profile`); `docs/specs/0004-product-decisions-and-backlog.md` §10–§11,
  UI4 backlog row

Scope: composition of the `/profile` route. Behavior (My Cafes = distinct
cafes with ≥1 check-in ordered by latest visit; created-by-me badge on
`is_creation`; My Check-ins = all rows newest `visited_at` first) is
canonical in spec 0004 §10 and is referenced, not redefined.

---

## 1. Design intent

Profile is **your personal coffee atlas** — the one place the product talks
to *you* about *your* data. Owner directive (DG102): this must be a
design-forward page, not an old-school Google Maps profile. So: generous
typography, a hero header with presence, cards instead of bare rows, and
warm microcopy. It stays honest — no gamification, no streaks, no vanity
metrics — but quiet no longer means plain. Think: a beautifully typeset
field journal of where you've worked.

MVP identity is anonymous publicly (spec 0004 §18a); this page is *your
data for you*.

## 2. Page composition

Centered column, 640px max width, 16px side padding (mobile) / 24px
(desktop). No map, no sheet — a dedicated content page.

1. **Hero header**: 80px avatar circle (provider avatar; else
   `surface-tertiary` with the user's initial in display font, DG95) with a
   low-contrast cup-glyph watermark behind it (the DG43 non-content graphic
   language, ≤8% opacity, single hue, `aria-hidden`). Display name
   (`font-display`, `text-2xl`) — editable inline (pencil affordance →
   inline input, 24 chars max); fallback chain: provider name → email
   prefix (before the `@`, never the full email, DG95). Under it, the
   current-city chip (`surface-secondary`, `radius-sm`, `text-xs`) — also
   editable (tap → city Select popover, same set as search §5) because it
   scopes discovery and search (DG97). Top-right: ghost `Sign out`
   (48px touch target; only action at MVP — account deletion is V2, DG98).
2. **Stats row**: two stat blocks — `Cafes` and `Check-ins` — each a
   `text-2xl` tabular `foreground` numeral over a `text-xs` `muted` label,
   separated by a 1px `separator` rule. Counts come straight from the two
   primary lists; no derived vanity metrics. Numbers count up once on first
   load (300ms, tabular; reduced motion → final values instantly).
3. **Tabs** (DG102): the segmented-control language from
   discovery-sheet-v1 §6, left aligned, horizontally scrollable on narrow
   screens: **`My Check-ins` (default)** · `我的咖啡地图` (My Coffee Map —
   DG103) · `Favorites` · `Search History`.

## 3. Tabs and their content

### My Check-ins (default)

Cards, not bare rows: `surface` card, 1px `border`, `radius-md`, 12px
padding. Cafe name (`font-display`, `text-md`) + `visited {date}`
(`text-xs`, `muted`), the check-in's own set dimensions as text chips
(`wifi 87 · coffee 81`, `text-xs`, `muted`, tabular — only dimensions the
user actually set, honest unset rules), a right-aligned like count (heart
glyph + count, `text-xs`, `muted` — kept, DG100: the quiet feedback loop
that your data helped someone), and a 36px ghost edit (pencil) button
opening the check-in drawer in edit mode (checkin-system-v1 §5). Card tap
→ `/cafes/[id]`. If the cafe was soft-deleted, the card stays but renders
unlinked with the name in `muted` (DG99).

### 我的咖啡地图 (My Coffee Map)

The spec's "My Cafes" list (distinct cafes with ≥1 check-in, latest visit
first). Rows reuse the discovery card content language: 72px 4:3 cover,
cafe name (`font-display`, `text-md`), meta line `Last visit 12 Aug · 3
check-ins` (`text-xs`, `muted`, tabular). A `Created by me` badge renders
as plain `secondary` sage text with a small `+` glyph, `text-xs`, after the
name — text, not a pill background. Row tap → `/cafes/[id]`. Soft-deleted
cafes are hidden entirely (DG99).

### Favorites (design-ahead)

The favorites feature is post-MVP (spec 0004 backlog); this tab is designed
now and ships with its empty state until the feature lands (DG102).
Composition when live: same cover-card rows as 我的咖啡地图. Empty state:
display-font line `还没有收藏` (`text-lg`), body `看到喜欢的咖啡馆，点一颗
小心心收藏起来` (`text-sm`, `muted`) — pointing at the favorite affordance
that will live on cafe detail.

### Search History (design-ahead)

Client-side recent searches (spec 0004 §11 as amended — lightweight local
storage, never server-side at MVP). Rows: the query text (`text-sm`,
`foreground`) + city chip + relative time (`text-xs`, `muted`), leading
search glyph. Tap → opens the search overlay with the query pre-filled.
A ghost `Clear` text-button at the tab's foot wipes the local history.
Empty state: `还没有搜索记录` (`text-sm`, `muted`). (This is the profile
page's private history view; the search overlay itself still shows no
recents — DG55 stands.)

### Pagination

The two primary lists paginate with an outline `Load more` button at the
foot (20 per page, matching the feed page size), not infinite scroll.

## 4. App-like navigation (DG101)

The page must navigate like an app, not a website:

- **Entry**: a 36px avatar circle at the right end of the floating search
  bar on mobile, at the top of the sidebar on desktop. Signed-out/anonymous
  sessions show a person glyph; tapping that opens the sign-in gate (§5)
  instead of navigating.
- **Back**: opening `/profile` pushes exactly **one** history entry.
  Browser back, iOS swipe-back, and Android back all return to the map
  **exactly as left** — selection, sheet detent, and scroll position intact
  (the discovery controller's state survives; nothing refetches). A
  back-chevron in the page header mirrors the same behavior. If the user
  landed on `/profile` directly (fresh load, no prior state), back/chevron
  goes to `/`.
- No in-app links on this page lead "away" — cafe rows open the cafe inside
  the app's own detail surface.

## 5. States

- **Anonymous session** (DG94): the page renders the gate, not the data —
  display-font line `Your cafes live here` (`text-xl`), body `Sign in —
  your check-ins will be waiting · 登录后，你现在的记录都会保留`
  (`text-sm`, `muted`; the second clause promises the anonymous-history
  merge), and the standard `SignInButton` (accent, solid, all providers
  per DG66). No fake preview content.
- **Loading**: skeleton hero circle + two stat blocks + 4 cards, HeroUI
  Skeleton shimmer (initial load only).
- **Empty (new user)**: tabs render normally; My Check-ins shows
  `No check-ins yet` (`text-sm`, `muted`) + inline text-button `Find a cafe
  to check in` (`accent`) linking to `/`. Favorites/Search History use
  their §3 empty states.
- **Fetch failure**: last content preserved; inline warning glyph +
  `Couldn't load` + outline `Retry` (shared state language).
- **SEO/privacy** (DG96): `noindex`, SSR per request, never CDN-cached.

## 6. Motion, dark mode, accessibility, i18n

- Tab switch: 120ms pill slide + 200ms content crossfade. Stats count up
  once (above). Nothing else animates.
- Token-only; dark mode with zero overrides. Avatars never dimmed.
- Tabs are `role="tablist"` with arrow-key navigation; edit buttons have
  `aria-label="Edit check-in at {cafe}"`; stat numbers carry text labels.
- Keys under `profile.*`. zh references: `My Check-ins` → `我的打卡`
  (default tab), `My Coffee Map` → `我的咖啡地图` (DG103), `Favorites` →
  `我的收藏`, `Search History` → `搜索历史`, `Created by me` → `由我收录`,
  `Sign out` → `退出登录`, `Load more` → `加载更多`, `Your cafes live
  here` → `你的咖啡馆都住在这儿`, `Sign in — your check-ins will be
  waiting` → `登录一下，你的打卡都在等你`, `No check-ins yet` →
  `还没有打卡`, `Find a cafe to check in` → `去找家咖啡馆打卡吧`,
  `Couldn't load` → `加载失败，再试试？`, `Clear` → `清空`,
  `还没有收藏` / body `看到喜欢的咖啡馆，点一颗小心心收藏起来`,
  `还没有搜索记录`.

## 7. Visual acceptance criteria (owner sign-off)

- [ ] The page reads as a designed personal atlas — display typography,
      hero header, cards — not a settings list (DG102).
- [ ] Still honest: no gamification, streaks, or vanity metrics.
- [ ] The two stats match the list contents exactly.
- [ ] Default tab is My Check-ins; all four tabs reachable with one thumb.
- [ ] Back (browser, swipe, chevron) always returns to the map as left —
      verify with iOS swipe-back and Android back (DG101).
- [ ] Anonymous visitors see the gate with the data-preservation promise,
      never an empty ledger (DG94).
- [ ] `Created by me` is visible but quiet (text badge, sage).
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Opt-in public identity (#139, V2), the favorites feature itself (post-MVP;
this artifact designs its tab), server-side browsing history (post-MVP),
account deletion flow (V2, DG98), the check-in drawer (checkin-system-v1),
the cafe detail page (seo-sharing-v1), auth internals.
