# Profile Page — Design Artifact v1

- Slice: `profile-page` (issue #152)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — copy tone sweep per DG87/DG93)
- Base: `docs/design/discovery-sheet-v1.md` (card language, segmented
  control), `docs/design/checkin-system-v1.md` (edit drawer)
- Specs: `docs/specs/0001-nextjs-migration.md` §Rendering strategy
  (`/profile`); `docs/specs/0004-product-decisions-and-backlog.md` §10
  (My Cafes / My Check-ins), UI4 backlog row

Scope: composition of the `/profile` route. Behavior (My Cafes = distinct
cafes with ≥1 check-in ordered by latest visit; created-by-me badge on
`is_creation`; My Check-ins = all rows newest `visited_at` first) is
canonical in spec 0004 §10 and is referenced, not redefined.

---

## 1. Design intent

Profile is a utility page, not a social page — MVP identity is anonymous
publicly (spec 0004 §18a), so this page is *your data for you*. It should
feel like a calm ledger: what you've contributed, where you've worked. No
gamification, no streaks, no badges beyond the spec's created-by-me marker.

## 2. Page composition

Centered column, 640px max width, 16px side padding (mobile) / 24px
(desktop). No map, no sheet — a plain content page with the global header.

1. **Header block**: 64px avatar circle (`surface-tertiary` with the user's
   initial in display font when no avatar image exists), display name
   (`font-display`, `text-xl`) with email fallback, and one meta line:
   current city chip (`surface-secondary`, `radius-sm`, `text-xs`) if set.
   Right side: ghost `Sign out` button (48px touch target, top-right).
2. **Stats row**: two stat blocks side by side, separated by a 1px
   `separator` rule: `Cafes` and `Check-ins`, each a `text-xl` tabular
   `foreground` number over a `text-xs` `muted` label. Two stats only —
   counts that come straight from the two lists below; no derived vanity
   metrics.
3. **Tabs**: the same segmented control language as Helpful/Newest
   (discovery-sheet-v1 §6): `My Cafes` / `My Check-ins`, 32px track,
   left aligned. Default tab: `My Cafes`.

## 3. Lists

### My Cafes

Rows reuse the discovery card content language: 72px 4:3 cover, cafe name
(`font-display`, `text-md`), meta line `Last visit 12 Aug · 3 check-ins`
(`text-xs`, `muted`, tabular). A `Created by me` badge (spec §10) renders as
plain `secondary` sage text with a small `+` glyph, `text-xs`, after the
name — text, not a pill background (consistent with the search POI badge).
Row tap → `/cafes/[id]` (SSR page, owned by seo-sharing).

### My Check-ins

Rows: cafe name (`text-md`, display font) + `visited {date}` (`text-xs`,
`muted`), then the check-in's own set dimensions as text chips
(`wifi 87 · coffee 81`, `text-xs`, `muted`, tabular — only dimensions the
user actually set, honest unset rules apply), and a right-aligned like count
(heart glyph + count, `text-xs`, `muted`). Row tap → `/cafes/[id]`. Each row
carries a 36px ghost edit (pencil glyph) button opening the check-in drawer
in edit mode (checkin-system-v1 §5).

Both lists paginate with an outline `Load more` button at the foot (20 per
page, matching the feed page size), not infinite scroll — a ledger ends.

## 4. States

- **Unauthenticated**: no redirect. The page renders a calm gate: display
  font line `Your cafes live here` (`text-xl`), body `Sign in — your
  check-ins will be waiting` (`text-sm`, `muted`), and the standard
  `SignInButton` (accent, solid). No fake preview content.
- **Loading**: skeleton header circle + two stat blocks + 4 rows, HeroUI
  Skeleton shimmer (initial load only).
- **Empty (new user)**: tabs render with zero counts; the active tab shows
  `No check-ins yet` (`text-sm`, `muted`) + inline text-button `Find a cafe
  to check in` (`accent`) linking to `/`.
- **Fetch failure**: last content preserved; inline warning glyph +
  `Couldn't load` + outline `Retry` (shared state language).

## 5. Motion, dark mode, accessibility, i18n

- Tab switch: 120ms pill slide + 200ms list crossfade (shared control
  behavior). Stats count up once on first load (300ms, tabular, reduced
  motion → final values instantly). Nothing else animates; this page is
  deliberately quiet.
- Token-only; dark mode with zero overrides. Avatars never dimmed.
- Tabs are `role="tablist"` with arrow-key navigation; edit buttons have
  `aria-label="Edit check-in at {cafe}"`; stat numbers carry text labels
  (no icon-only stats).
- Keys under `profile.*`. zh references: `My Cafes` / `My Check-ins` →
  `我的咖啡馆` / `我的打卡`, `Created by me` → `由我收录`, `Sign out` →
  `退出登录`, `Load more` → `加载更多`, `Your cafes live here` →
  `你的咖啡馆都住在这儿`, `Sign in — your check-ins will be waiting` →
  `登录一下，你的打卡都在等你`, `No check-ins yet` → `还没有打卡`,
  `Find a cafe to check in` → `去找家咖啡馆打卡吧`, `Couldn't load` →
  `加载失败，再试试？`.

## 6. Visual acceptance criteria (owner sign-off)

- [ ] The page reads as a ledger, not a social profile — no gamification.
- [ ] The two stats match the list contents exactly.
- [ ] `Created by me` is visible but quiet (text badge, sage).
- [ ] Edit affordance is discoverable without crowding the row.
- [ ] The unauthenticated gate is calm and honest, no fake preview.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Opt-in public identity (#139, V2), browsing/view history (spec 0004 §11,
post-MVP), the check-in drawer (checkin-system-v1), the cafe detail page
(seo-sharing-v1), auth internals.
