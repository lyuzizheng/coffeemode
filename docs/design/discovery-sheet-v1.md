# Discovery Sheet — Design Artifact v1

- Slice: `discovery-sheet` (issue #133)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-20 (revised 2026-08-21 — FULL header gains the
  `Edit your check-in` row per DG72)
- Specs: `docs/specs/0001-nextjs-migration.md` (rendering strategy, discovery
  contract), `docs/specs/0002-design-system.md` (tokens, motion, a11y),
  `docs/specs/0004-product-decisions-and-backlog.md` §18b–18g, DG1–DG20
  (`docs/alignment-temp/alignment-progress.md`)

Scope of this artifact: composition, hierarchy, iconography, responsive
treatment, motion detail, and visual states for the discovery surface. Behavior
(URL sync, gestures, pagination, focus rules, ranking) is canonical in the
specs and is referenced, not redefined.

---

## 1. Design intent

Discovery is scan-first. The user is answering one question: *where can I sit
down and work right now?* Every composition decision follows from that:

- PEEK optimizes scanning many cafes (characteristics, not scores).
- HALF answers "is this one good for work?" (Work Score is the hero).
- FULL proves it (dimension bars, policy consensus, real check-ins).

The Work/composite score is the product's unique data and is the visual hero
everywhere it appears. Experience is always present but always subordinate.

## 2. Iconography (resolves DG6)

Bespoke inline-SVG icon set, no new dependency. Components live in
`web/components/icons/`; each is a 16×16 viewBox, 1.5px stroke, round
caps/joins, `currentColor`, geometric (no hand-drawn or illustrative style).
HeroUI built-in icons (e.g. `SearchField.SearchIcon`) are used where they
exist; this set covers only what HeroUI lacks.

| Concept | Glyph | PEEK value format |
| --- | --- | --- |
| Wifi | three concentric arcs + dot | score `87` |
| Outlets | two-prong plug, cord stub | score `72` |
| Stay limit | clock face, hands at 3h | policy label `3h` / `1h` / `peak` / `∞` |
| Seats | simplified chair profile | score `64` |
| Temperature | thermometer | score `70` |
| Coffee | plain cup outline (no steam, no beans) | score `81` |

Rules:

- PEEK shows **at most 4** characteristic facts per card, in fixed priority
  order: wifi → outlets → stay limit → seats → temperature → coffee.
- Only facts with data render; a missing fact collapses (no placeholder icon,
  no zero). Icons never appear without their value — color is never the only
  signal.
- Scores render as integers with tabular numerals, `text-xs`, `muted`
  foreground, icon at 14px optical size.
- The "Not enough check-ins" treatment (DG10) applies in HALF/FULL, not PEEK —
  a dimension with zero responses simply contributes no PEEK icon.

## 3. Score hierarchy (resolves DG7)

Two scores, one hero. The ✨/📊 marks in meeting notes were shorthand; **no
emoji in the UI**.

- **Work Score** (composite, weighted dimensions) — primary:
  - Number in the body font (Inter), `text-xl`, tabular, `accent` color. The
    display font is reserved for titles and cafe names (spec 0002 typography
    rules); the hero treatment comes from scale, color, and the bar below,
    not from the typeface.
  - Thin 2px `accent` bar under the number, width = score %, track
    `surface-tertiary`. This visually rhymes with the WorkProfile dimension
    bars in FULL.
  - Label `Work`, `text-xs`, `muted`, normal case (no uppercase eyebrows).
- **Experience** (mean overall) — secondary:
  - 14px four-point sparkle SVG + number, `text-sm`, `foreground` at 80%
    weight; label `Experience`, `text-xs`, `muted`.
- Both scores always show the respondent count beside them:
  `87 · 23 check-ins` (`text-xs`, `muted`). Missing values never render as 0 —
  the score block collapses to its "Not enough check-ins" line.
- HALF lays the two score blocks side by side, Work left, Experience right,
  separated by a 1px `separator` vertical rule. FULL repeats the same pair in
  the detail header, then explains the Work Score's composition in the
  WorkProfile section.
- PEEK exception (DG43): only the Work score appears before HALF, and only as
  the decorative watermark numeral plus its exact `Work 82` value in the meta
  line (§5.1). The full pair still belongs to HALF onward.

## 4. Cafe actions (resolves DG8)

Actions: **Check in** (primary), **Navigate** (secondary), **Share**
(tertiary). One row, three elements:

- Check in — solid `accent` Button, `flex-1`, `radius-sm`.
- Navigate — outline Button in `secondary` (sage), fixed min-width 96px.
- Share — icon-only ghost Button, 36×36px, share-node glyph, `muted` →
  `foreground` on hover.

Placement:

- PEEK: **no actions**. Cards are scan-oriented; the whole card is the tap
  target that selects the cafe.
- HALF: the row sits directly under the score row, full width, 8px gap.
- FULL: the same row appears in the detail header beneath the title block. It
  scrolls away with content — it is not sticky (the sheet already reserves the
  persistent Check-in affordance via HALF).

## 5. Mobile sheet composition

One sheet, three snap states. Drag handle: 36×4px, `radius-full`,
`separator` color, centered, 8px top inset. Sheet surface `overlay`, top
radius `radius-lg`, `shadow-lg` warm tint, 1px top `border`.

Drag/scroll ownership is spec-owned (DG15, spec 0004 §18c): only the
handle/header drags the sheet; content scrolls and hands a downward pull back
to the sheet only at scroll-top. Visually this means the handle + header zone
is the single obvious grab affordance — the handle is always rendered (all
three snap states), and the header zone gets no competing horizontal chrome.

### 5.1 PEEK (no selection)

```text
┌─────────────────────────────────┐
│             ────                │  drag handle
│ ┌───────────┐ ┌───────────┐ ┌───┤
│ │ cover     │ │ cover     │ │   │  cards ~85% width, snap carousel
│ │ 88px 4:3  │ │        82 │ │   │  Work-score watermark (low contrast)
│ │ Name      │ │           │ │   │
│ │ area · km │ │           │ │   │
│ │ ⌁ 87 ⚡72 │ │           │ │   │  ≤4 characteristic facts
│ └───────────┘ └───────────┘ └───┘
└─────────────────────────────────┘
```

- Card: horizontal layout. Left: 88px 4:3 cover image, `radius-md`, 1px
  `border`. Right column, 12px padding: cafe name (`font-display`, `text-md`,
  single-line truncate), then `area · 1.2 km` (`text-xs`, `muted`), then the
  characteristic icon row (14px icons + `text-xs` values, 12px gaps).
- **Work-score watermark** (DG43): the composite score as a large numeral
  bleeding off the card's right edge — body font (numbers never use the
  display font, DG22), ~4rem at weight 200, `foreground` at 7% opacity,
  `aria-hidden`, pointer-events disabled, clipped by the card radius. It is
  a non-content graphic exempt from the type-scale ceiling (spec 0004 §5).
  Single hue only — no multi-color gradient, no literal battery gauge; the
  "innovative score display" brief is met by scale and restraint, not
  chrome. The exact value stays readable as `Work 82` (`text-xs`, tabular,
  `muted`) at the end of the meta line. A cafe with no Work data renders no
  watermark and no value — never a zero.
- Card surface `surface`, 1px `border`, `shadow-sm`; `radius-md`. Active card
  scales to 1.02 and neighbors dim to 60% opacity (signature moment, spec
  0002). Cover gets the subtle parallax on swipe.
- No actions and no open/closed badge in PEEK — scan speed over depth.
  Open/closed appears from HALF; the full score pair appears from HALF (§3).

### 5.2 HALF (selected cafe)

Top to bottom, 16px side padding, 12px section rhythm:

1. **Cover carousel** — 16:9, `radius-md`, page dots (3px, `separator`,
   active `accent`), edge-swipe between photos.
2. **Title block** — cafe name (`font-display`, `text-lg`), then one meta
   line: `area · 1.2 km · Open until 22:00` (`text-xs`, `muted`; open state
   uses `success` text + dot, closed uses `danger` — always icon + text).
3. **Score row** — Work | Experience pair from §3.
4. **Action row** — from §4.
5. **Top facts** — up to 3 characteristic chips (icon + value, `surface-secondary`
   background, `radius-sm`, 6px/10px padding), same priority order as PEEK.

HALF answers "worth a closer look?" in one glance: name, open now, Work Score,
Check in.

### 5.3 FULL (complete detail)

Map stays visible ~15% at top. Content is a single scroll column:

1. **Header** — cafe name (`font-display`, `text-xl`), address + hours meta
   lines, then the §3 score pair, then the §4 action row. When the viewer
   has a live check-in at this cafe, an `Edit your check-in` text row
   (`text-sm`, `accent`) sits directly under the action row and opens the
   check-in drawer in edit mode (DG72; composition owned by
   `checkin-system-v1` §5).
2. **WorkProfile** — the visual hero. Five dimension bars
   (wifi / outlets / seats / temp / coffee), each a row: label (`text-sm`,
   88px fixed), bar track (`surface-tertiary`, 6px height, `radius-full`),
   fill (`accent`, width = score %), value right-aligned (`text-sm`, tabular).
   Each row ends with its respondent count (`text-xs`, `muted`). A
   zero-response dimension renders the label plus `Not enough check-ins`
   (`text-xs`, `muted`, italic) — never a zero bar (DG10).
3. **Policy consensus** — two stacked rows: `Min spend` and `Max stay`
   (`text-sm` labels) with the consensus value as a read-only chip
   (`surface-secondary`, `radius-sm`). Unknown consensus renders the
   `unknown` chip honestly.
4. **Gallery** — horizontal thumbnail scroll (72px squares, `radius-md`,
   8px gaps) when photos exist; section omitted entirely when empty.
5. **Check-in feed** — section heading `Check-ins` (`text-lg`), the §6 mode
   control, then check-in cards:
   - `A nomad · Mar 2026` (`text-sm`; MVP identity is anonymous, DG13)
   - dimension mini-scores as text chips: `wifi 87 · coffee 81` (`text-xs`,
     `muted`, tabular)
   - note text (`text-base`, foreground), photo thumbnails if any
   - like row: heart-outline glyph + count (`text-xs`, `muted`; filled
     `danger` when liked by the viewer — icon + count, never color alone)
   - card: `surface`, 1px `border`, `radius-md`, 12px padding

## 6. Helpful/Newest control (resolves DG11)

A two-option segmented control placed directly above the feed list, left
aligned, inline with the `Check-ins` heading row (heading left, control
right).

- Track: `surface-secondary`, `radius-sm`, 2px padding, height 32px.
- Segment: `text-sm`, 10px horizontal padding. Active segment gets `surface`
  background + 1px `border` + `foreground` text; inactive is `muted`.
- Labels: `Helpful`, `Newest` (i18n keys, zh: `最有用` / `最新`).
- Switch animation: 120ms (`motion.feedback`) background slide on the active
  pill; feed content crossfades in 200ms with a `layoutId` reflow. No spinners
  on mode switch — previous mode's content stays until the new page arrives
  (stale-while-revalidate, DG17).
- The control scrolls with the feed (not sticky); at MVP page sizes the header
  is one gesture away.

## 7. Desktop composition (≥1024px)

Same selection/URL state, different chrome. The mobile snap states never
appear here.

- **Left sidebar, 380px**, full height, `surface` background, 1px right
  `border`:
  - Sticky top: search field + filter button (search/filter internals belong
    to the `search-filters` artifact; this artifact reserves a 48px row).
  - Scrollable cafe list below. List rows carry the same content as PEEK
    cards (cover, name, meta, ≤4 facts) at full sidebar width, 8px vertical
    gaps.
  - Selected row: `surface-secondary` background + 2px `accent` left edge.
- **Detail panel — second left column** (DG42): 400px, full height, sitting
  immediately right of the sidebar; the map fills the remaining width. It
  opens with a 200ms `motion.state` slide-in from the left edge of its
  column and closes with `Esc` or the 36px ghost × at its top-right. Surface
  `overlay`, 1px left `border`, no floating shadow — it is a column, not an
  overlay. Content = the FULL composition (§5.3) unchanged. Layout:
  `| sidebar 380px | detail 400px | map (flex) |`; with no selection the
  detail column is absent and the map spans the rest.

## 8. Tablet landscape validation (resolves DG20's Kimi check)

768–1023px keeps the mobile sheet (per DG20). Composition adjustments:

- PEEK card width clamps to `clamp(280px, 55%, 420px)` — two cards partially
  visible, carousel affordance preserved.
- HALF cover carousel caps at 360px height; the title/score/action block
  stays single-column.
- FULL content column centers with a 640px max-width so bars and feed do not
  stretch across the tablet width.

Validated: no overlap between FAB (bottom-right) and the sheet's action row at
HALF on 768×1024 and 1024×768; handle stays reachable with the sheet at FULL.

## 9. States

- **Initial loading**: skeleton cards — cover block + two text bars + icon-row
  bar, HeroUI Skeleton shimmer on `surface` cards. Skeletons are allowed only
  for the initial load (spec 0002).
- **Empty nearby**: no cards. Display-font line `No cafes nearby yet`
  (`text-lg`), body `Be the first to check in` (`text-sm`, `muted`), and a
  solid `accent` `Add a cafe` button. No illustration.
- **Feed refresh/pagination failure** (DG17): previous content stays. Inline
  row at the failed section: warning glyph + `Couldn't load check-ins`
  (`text-sm`) + outline `Retry` button (`accent` text/border). 200ms fade-in.
- **Missing cafe in-app** (DG19): selection clears, URL replaces to `/`,
  sheet returns to PEEK, and a HeroUI toast slides up: neutral `overlay`
  surface, foreground text `This cafe is no longer available`, 4s, no icon
  decoration beyond the default toast glyph.
- **Empty feed in FULL**: `No check-ins yet` (`text-sm`, `muted`) + inline
  text-button `Be the first — Check in` (`accent`).
- **Offline**: the global offline banner covers this; discovery itself renders
  last-cached content without additional chrome.

## 10. Motion detail

All timings/easings from spec 0002; this artifact assigns them:

- Sheet snap state changes: 300ms `ease.default`; reduced motion → instant.
- Card snap/parallax: scroll-driven, no added duration; active-card scale/dim
  200ms `ease.default`.
- Score bars (§3 hero + WorkProfile): width animates 300ms `ease.default`,
  rows staggered 40ms, once on entry; reduced motion → final state instantly.
- Feed mode switch: 120ms pill slide + 200ms content crossfade.
- Skeleton → content: 150ms fade.
- Toast in 200ms / out 150ms.

## 11. Dark mode and accessibility

- Every value above is a semantic token — dark mode is the espresso palette
  from spec 0002 with zero per-component overrides. Cover images are never
  dimmed.
- Non-modal sheet and drawer; no focus trap. Selection focuses the detail
  heading; Close restores focus to the source card (DG18, spec-owned).
- The segmented control is a `role="tablist"` pair with arrow-key navigation.
- Like button carries `aria-pressed`; scores carry `aria-label` with the
  numeric value; characteristic icons are `aria-hidden` with their values as
  real text.
- `accent` is used for large numbers, bars, and primary buttons only; body
  text stays `foreground`/`muted` to hold the 4.5:1 contrast rule in both
  themes.

## 12. Internationalization

All copy via next-intl keys under `discovery.*`; examples above are `en`.
`zh` references: `Helpful/Newest` → `最有用/最新`, `Not enough check-ins` →
`打卡数据不足`, `A nomad` → `一位 nomad`, `No cafes nearby yet` →
`附近还没有咖啡馆`.

## 13. Visual acceptance criteria (owner sign-off)

- [ ] PEEK reads as a scannable strip: ≤4 facts, no actions, and the
      Work-score watermark is felt more than read (≤8% opacity, single hue).
- [ ] Work Score is unmistakably the hero from HALF onward; Experience is
      present but subordinate.
- [ ] Desktop detail sits as a second left column beside the sidebar; the map
      keeps the remaining width (DG42).
- [ ] FULL's WorkProfile bars feel like the product's signature, matching the
      restraint rules (no confetti, no gradient, no glass).
- [ ] Helpful/Newest reads as one segmented control, not two buttons.
- [ ] Retry/toast/focus/reduced-motion states match §9–§11.
- [ ] Tablet landscape (768–1023px) composition holds per §8.
- [ ] Dark mode requires no per-component overrides.

## Out of scope (other slices)

Search/filter internals (`search-filters`), map markers and map chrome
(`map-home`), SSR `/cafes/[id]` route (`seo-sharing`), check-in drawer
(`checkin-system`).
