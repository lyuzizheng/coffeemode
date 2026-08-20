# Search & Filters — Design Artifact v1

- Slice: `search-filters` (issue #135)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-20
- Base: stacked on `docs/design/discovery-sheet-v1.md` (icon set, tokens,
  state language are shared)
- Specs: `docs/specs/0001-nextjs-migration.md` §Search, §Rendering strategy;
  `docs/specs/0002-design-system.md`; `docs/specs/0004-product-decisions-and-backlog.md`
  §19–§21

Scope: composition of the search entry, filter controls, result list, and
their states. Behavior (merge/dedupe rules, 10 km cap, cursor/URL contract,
external-search flywheel) stays canonical in the specs and is referenced, not
redefined.

---

## 1. Design intent

Search is a task surface, not a browsing surface. The user arrives with a
constraint ("workable wifi, near me, open now") and wants a shortlist fast.
Two rules follow:

- **No precision theater.** A 0–100 slider implies the user can feel the
  difference between wifi 63 and 67. They cannot. Filters use coarse, honest
  steps.
- **Filters are a panel, not a form.** One-tap controls, live results, no
  Apply button. The filter surface is visually distinct from the map and from
  the discovery sheet (spec 0004 §21).

## 2. Conscious departure from the `theme-preview` prototype

`web/app/theme-preview/sections/search-filter-section.tsx` renders six
always-on 0–100 `ScoreSlider`s with default 50/60. That is exactly the "long
modal form" spec 0004 §21 forbids, and the defaults make every filter look
active when nothing is. The theme-preview file is a sandbox (F3), not
canonical UI; this artifact supersedes its composition:

- Dimension minima become **tri-state segments** (`Any` / `60+` / `80+`) —
  see §4.
- Nothing is active by default; the panel reads "no filters" until the user
  touches a control.

The 0–100 threshold contract is preserved: segments emit concrete threshold
numbers into the same deep-linkable URL parameters (`filter_wifi=60`).

## 3. Surfaces and entry points

### Mobile (<1024px)

- **Entry**: the floating top search bar (map home) or the sidebar search row.
  Tapping it opens the **search overlay**: full-screen, `overlay` surface,
  slides up 300ms `ease.default`. Search field autofocused at top with a
  city scope chip beside it (§5).
- **Filter entry**: a Filter button (funnel glyph + active-count badge, e.g.
  `· 3`) pinned at the right end of the search field row. It opens the
  **filter panel**: a HeroUI modal bottom sheet, content-height detent, 85%
  max height, `radius-lg` top, scrimmed. Unlike the non-modal discovery
  sheet, this is a bounded task — focus is contained while it is open, `Esc`,
  scrim tap, or drag-down closes it, and closing returns focus to the Filter
  button.
- **Results**: render inside the search overlay as a vertical list (§6).

### Desktop (≥1024px)

- Search field + Filter button live at the top of the 380px discovery
  sidebar (the 48px row reserved by `discovery-sheet-v1` §7).
- The filter panel is **inline**: a collapsible section directly under the
  search row, pushing results down — no modal on desktop. Same controls, same
  order, two-column grid for the dimension segments when width allows.
- Results render as the sidebar list (shared selection state with discovery).

### SSR `/search`

- The deep-linkable page (`/search?q=&city=&filter_*=`) renders the same list
  server-side: filter controls as a left column at ≥1024px, a collapsed
  `Filters (n)` disclosure row below it on mobile. First-visit deep-link
  onboarding uses the lightweight banner (spec-owned), never a full-screen
  interruption.

## 4. Filter controls (top to bottom)

Panel header: `Filters` (`text-lg`) left; live result count right
(`12 places`, `text-sm`, `muted`, tabular); `Reset` ghost button appears only
when ≥1 filter is active.

1. **Open now** — Switch row, always first (time-sensitive intent). Label +
   switch, 48px row height.
2. **Work dimensions** — six rows (wifi, outlets, seats, temp, coffee,
   overall). Each row: the 14px characteristic icon (discovery-sheet-v1 §2
   set) + label (`text-sm`, 96px) + a three-segment control:
   `Any` / `60+` / `80+`. Segment styling matches the Helpful/Newest control
   (discovery-sheet-v1 §6): `surface-secondary` track, active segment
   `surface` + 1px `border`, 120ms pill slide. `Any` is the default and means
   "no threshold" — the parameter is omitted from the URL entirely.
3. **Min spend / Max stay** — two `PolicyChips` single-select groups
   (existing theme-preview pattern), with `Any` as the first chip and
   default. Chip values per spec: `none | drink | s5 | s10 | s10plus` and
   `unlimited | 3h | 2h | 1h | peak`. `unknown` is **not** offered as a
   filter — filtering by "unknown" selects cafes with no data, which is a
   research tool, not a nomad tool.

**Live apply**: every change applies immediately — results refetch, the URL
replaces (no history spam), and the header count updates. There is no Apply
button. Reflow uses Framer `layoutId` list animation (spec 0002 signature
moment); in-flight changes keep the last successful list with a small inline
refresh shimmer at the list head, never skeletons over real content.

## 5. City scope

City is scope, not a filter: a compact chip button at the left end of the
search field row — `Singapore ▾` (`text-sm`, `surface-secondary`,
`radius-sm`, chevron 12px). It opens a `Select` popover of supported cities
(MVP: Singapore; schema supports more). Changing city clears `q` results and
refetches; the city persists per the spec's storage rules.

## 6. Result list

Rows reuse the discovery card content language (consistency beats novelty):
72px 4:3 cover (or a `surface-tertiary` placeholder block with the cup glyph
for coverless POIs), name (`font-display`, `text-md`), meta line
(`area · 1.2 km · Open until 22:00`), and the ≤4 characteristic icon row for
cafes that have work data.

Row types, visually distinguished:

- **Own cafe** — full row as above; selecting it opens the discovery detail
  (shared selection state) on map home, or navigates to `/cafes/[id]` from
  the SSR page.
- **Saved POI not yet on CoffeeMode** — same row + a muted text badge
  `Not on CoffeeMode yet` (`text-xs`, `secondary` sage text, no pill
  background — text with a small `+` glyph). Selecting it enters the creation
  flow (owned by the `cafe-creation` slice; this artifact only reserves the
  entry point).
- **External prompt** — when local results are empty or weak, a footer block
  replaces "more results" chrome: display-font line `Not finding it?`
  (`text-md`), then two outline buttons `Search Google Maps` /
  `Search Apple Maps` (Apple hidden until owner credentials land — the
  configuration gate is spec-owned). External results append into the same
  list with the POI badge treatment.

## 7. States

- **Initial loading**: 4 skeleton rows (cover block + 2 text bars), HeroUI
  Skeleton shimmer — initial load only.
- **No results with filters active**: `No places match these filters`
  (`text-md`, display) + body `Try loosening one` (`text-sm`, `muted`) +
  inline text-button `Reset filters` (`accent`) + the external-search footer
  from §6.
- **No query yet**: the overlay shows the city scope and a single hint line
  `Search cafes, neighborhoods, or addresses` (`text-sm`, `muted`) — no
  recents/history (browsing history is out of MVP scope).
- **Fetch failure**: last successful list preserved; inline row `Couldn't
  search` + outline `Retry` (`accent`), matching discovery-sheet-v1 §9.
- **Offline**: global offline banner; search overlay still opens but external
  search buttons are disabled (`muted`, 50% opacity) with the cached list
  shown.
- **Reduced motion**: overlay/panel appear instantly; list reflow becomes a
  0ms state change.

## 8. Motion detail

- Overlay enter/exit: 300ms/150ms `ease.default` slide-up.
- Filter panel: HeroUI sheet spring (`ease.spring`, restrained); reduced
  motion → instant.
- Segment/chip selection: 120ms `motion.feedback`.
- Result count change: 200ms crossfade on the number.
- List reflow on filter change: Framer `layoutId`, ≤300ms.

## 9. Dark mode and accessibility

- Token-only, zero per-component overrides; the panel uses `overlay`, rows
  use `surface`, tracks use `surface-secondary`.
- Filter panel: labelled `role="dialog"` with `aria-label="Filters"`; focus
  moves to the first control on open and returns to the Filter button on
  close (it is a modal task surface by design — the non-modal rule applies to
  the discovery sheet, not to bounded task panels).
- Segments are `role="radiogroup"`/`radio`; chips keep toggle-button
  semantics (`aria-pressed`); every control has a visible focus ring
  (`accent`, 2px, offset 2px).
- The Filter button's active-count badge is text (`· 3`), never a bare dot —
  color is never the only signal.
- Contrast: `60+`/`80+` segment text stays `foreground`/`muted` on
  `surface-secondary`, ≥4.5:1 in both themes.

## 10. Internationalization

Keys under `search.*` and `filters.*` (en/zh). zh references: `Filters` →
`筛选`, `Any/60+/80+` → `不限/60+/80+`, `Open now` → `营业中`,
`Not on CoffeeMode yet` → `还未收录`, `Search Google Maps` →
`搜索 Google 地图`, `Couldn't search` → `搜索失败`.

## 11. Visual acceptance criteria (owner sign-off)

- [ ] No sliders anywhere in the filter panel; tri-state segments read as one
      tap per dimension.
- [ ] Filter panel is unmistakably a task surface, distinct from both the map
      and the discovery sheet.
- [ ] Active filters are visible at a glance on the collapsed Filter button
      (count badge).
- [ ] Saved-POI rows are distinguishable without a pill/emoji badge.
- [ ] Live apply keeps the last good list during refetch (no skeleton flash).
- [ ] Desktop inline filter section and mobile sheet share control order.
- [ ] Dark mode requires no per-component overrides.

## Out of scope (other slices)

Map search overlay and marker binding (`map-discovery-integration`), provider
search inside creation (`cafe-creation`), the `/api/search` merge/dedupe
implementation (backend, unblocked), MapKit rendering (`map-home`).
