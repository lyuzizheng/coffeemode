# Onboarding & Geolocation — Design Artifact v1

- Slice: first-visit city + geolocation onboarding (issue #153)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21 (revised 2026-08-22 — copy tone sweep per DG87/DG93;
  2026-08-23 — grill round 15 rulings DG114–DG123; DG124 — deep-link
  banner replaced by SSR→app hydration)
- Base: `docs/design/discovery-sheet-v1.md` (icon set, tokens);
  `docs/design/seo-sharing-v1.md` (deep-link SSR→app hydration, DG124)
- Specs: `docs/specs/0001-nextjs-migration.md` §Onboarding & city model;
  `docs/specs/0002-design-system.md` (signature moments, motion.slow)

Scope: composition of the first-visit welcome card, the geolocation
permission choreography, and the locate button. Behavior (IP geolocation,
one-time localStorage flag with login merge, Singapore default, current-city
model, deep-link arrivals get the banner not the overlay) is canonical in
spec 0001 and is referenced, not redefined.

---

## 1. Design intent

Onboarding has exactly one job: get the user to useful local content with
minimum ceremony. The spec already forbids a full-screen interruption for
deep-link arrivals; this artifact extends the same respect to plain first
visits — a bottom-anchored card over the live map, not a welcome tunnel.
The map renders behind the card immediately: the product shows itself while
asking.

## 2. Welcome card (first visit to `/`)

Bottom-anchored card (map-native, consistent with every other surface),
full width minus 16px margins, max 420px centered, `overlay` surface,
`radius-lg`, `shadow-lg`, 1px `border`. Not modal: the map stays visible and
interactive behind it; no scrim.

Content, top to bottom, 16px padding, 12px rhythm:

1. 24px cup glyph (icon set) + `CoffeeMode` wordmark (`font-display`,
   `text-lg`) — the only place the wordmark appears in-app.
2. Headline: `Find a cafe you can actually work in` (`text-md`, display
   font).
3. Detection line: `Looks like you're in {city}` (`text-sm`, `muted`) —
   rendered only when IP detection produced a city.
4. Primary action: `Enable location` (solid `accent`, full width, 48px).
5. Secondary row: city `Select` (the same chip-button treatment as the
   search scope chip, search-filters-v1 §5) + ghost `Skip for now`.
6. No carousel, no feature tour, no "swipe through 3 slides" — one card,
   two choices.

Skip lands on the IP-detected city when one was detected (else the spec
default, Singapore) with the locate button available (DG116). The card
dismisses downward (150ms) and never returns (spec-owned one-time flag;
for logged-in users `profiles.onboarded` is authoritative — the card never
returns on any device, DG122).

## 3. Permission choreography

- **Tap `Enable location`** → browser geolocation prompt. While pending, the
  button label becomes `Locating…` at 60% opacity (no spinner).
- **Granted**: card dismisses, map centers on the user with the standard
  blue-dot treatment, and the discovery sheet loads nearby cafes. One
  `motion.slow` (450ms) ease on the map recenter — the single celebratory
  beat, and it is spatial, not decorative. Exception (DG119): if the user
  has panned the map since the card appeared, there is no recenter — the
  blue dot simply appears where they are looking; their expressed spatial
  intent wins.
- **Granted, outside every known city** (DG121): the city row is created
  at runtime and becomes the current city (spec-owned). The card's
  dismissal is paired with a first-nomad toast: `You're the first nomad in
  {city} — check in and help the next one`. This is an invitation, not an
  empty state: the map shows the city and the FAB is the obvious next step.
- **Denied**: no scolding. The card stays, the detection line swaps to
  `Location is off — pick your city` (`text-sm`, `muted`), the city Select
  is focused, and the primary button becomes `Use {selected city}` (solid
  `accent`). A toast explains once: `Location access was declined` (`muted`
  styling, no danger red — this is a preference, not an error). Re-entry
  after an OS-level denial (DG117): the locate button is the only path —
  a tap while denied shows a one-time toast, `Location is off — enable it
  in system settings`, instead of a dead prompt.

## 4. Locate button (persistent map control)

Crosshair glyph, 44px, `overlay` surface, `radius-md`, `shadow-map`, 1px
`border`; stacked above the FAB (bottom-right, 12px gap). States: idle
(`muted` glyph), locating (glyph pulses 1200ms, once per tap), located
(`accent` glyph until the user pans away). The blue dot persists for the
session once granted; re-tapping the button recenters the map on the dot
— the standard map behavior users already know (DG120). A tap while
permission is denied shows the one-time settings toast instead of a dead
prompt (DG117). On desktop the button moves to
the top-right map corner (24px inset) so it never collides with the sidebar
or the detail column (DG42). Keyboard reachable with `aria-label="Locate me"`.

## 5. Deep-link arrivals

First visit via `/cafes/[id]` or `/search`: no welcome card at all. Since
DG124 the deep-link page itself hydrates into the map app at FULL sheet
after its SSR first paint (seo-sharing-v1 §3) — the drag-down gesture
replaces the old banner. This artifact asserts no additional UI for that
path.

## 6. States and edges

- **Repeat visit**: no card, no banner; the locate button is the only
  geolocation surface. For logged-in users this holds across devices —
  `profiles.onboarded` is authoritative (DG122).
- **Offline first visit**: card still renders (city picker is local); the
  `Enable location` action stays available (geolocation is a browser API,
  not network). A grant offline still dismisses the card and recenters the
  map — only nearby content follows the global offline treatment (DG123).
- **Reduced motion**: card appears instantly; the recenter beat becomes an
  immediate jump; the locate pulse is suppressed.

## 7. Accessibility and i18n

- Card is `role="dialog"` labelled by its headline but **non-modal**: no
  focus trap, focus is not moved on mount (the map is the point); tab order
  reaches the card after the map controls.
- Permission outcomes are announced via the toast's polite live region.
- Keys under `onboarding.*`. zh references (spec-seeded): `Enable location`
  → `开启定位`, `Skip for now` → `暂时跳过`, `Looks like you're in {city}` →
  `你好像在 {city} 哦`, `Location is off — pick your city` →
  `定位没开，挑一个城市吧`, `Find a cafe you can actually work in` →
  `找到真正能办公的咖啡馆`, `Locating…` → `定位中…`,
  `Use {selected city}` → `就用{selected city}`, `Location access was
  declined` → `定位没开成功，没关系`, `You're the first nomad in {city} —
  check in and help the next one` →
  `你是 {city} 的第一位 nomad — 打个卡，帮后来的 nomad 种草避雷吧`,
  `Location is off — enable it in system settings` →
  `定位没开 — 去系统设置里打开吧`.

## 8. Visual acceptance criteria (owner sign-off)

- [ ] The map is visible and alive behind the welcome card — no tunnel.
- [ ] Two choices, one card: permission, or city + skip.
- [ ] Denied permission degrades gracefully without red error styling; a
      denied-state locate tap shows the one-time settings toast (DG117).
- [ ] A grant after the user has panned drops the blue dot without
      recentering (DG119); re-tap recenters on the persistent dot (DG120).
- [ ] An out-of-coverage grant creates the city and shows the first-nomad
      toast — an invitation, not an empty state (DG121).
- [ ] The locate button never collides with the FAB or the sheet handle on
      390px mobile, and sits clear of the sidebar on desktop.
- [ ] No tour, no carousel, no emoji.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Deep-link banner composition (seo-sharing-v1), the search city-scope chip
(search-filters-v1), server-side storage/merge of location and city
(spec-owned), map markers and map chrome (`map-home`).
