# Onboarding & Geolocation — Design Artifact v1

- Slice: first-visit city + geolocation onboarding (issue #153)
- Status: **Draft — pending owner approval**
- Author: Kimi K3
- Date: 2026-08-21
- Base: `docs/design/discovery-sheet-v1.md` (icon set, tokens);
  `docs/design/seo-sharing-v1.md` (deep-link banner for deep-link arrivals)
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

Skip lands on the spec default (Singapore) with the locate button available.
The card dismisses downward (150ms) and never returns (spec-owned one-time
flag).

## 3. Permission choreography

- **Tap `Enable location`** → browser geolocation prompt. While pending, the
  button label becomes `Locating…` at 60% opacity (no spinner).
- **Granted**: card dismisses, map centers on the user with the standard
  blue-dot treatment, and the discovery sheet loads nearby cafes. One
  `motion.slow` (450ms) ease on the map recenter — the single celebratory
  beat, and it is spatial, not decorative.
- **Denied**: no scolding. The card stays, the detection line swaps to
  `Location is off — pick your city` (`text-sm`, `muted`), the city Select
  is focused, and the primary button becomes `Use {selected city}` (solid
  `accent`). A toast explains once: `Location access was declined` (`muted`
  styling, no danger red — this is a preference, not an error).

## 4. Locate button (persistent map control)

Crosshair glyph, 44px, `overlay` surface, `radius-md`, `shadow-map`, 1px
`border`; stacked above the FAB (bottom-right, 12px gap). States: idle
(`muted` glyph), locating (glyph pulses 1200ms, once per tap), located
(`accent` glyph until the user pans away). On desktop the button moves to
the top-right map corner (24px inset) so it never collides with the sidebar
or the detail column (DG42). Keyboard reachable with `aria-label="Locate me"`.

## 5. Deep-link arrivals

First visit via `/cafes/[id]` or `/search`: no welcome card at all — the
spec's lightweight banner applies, composed in seo-sharing-v1 §3. This
artifact asserts no additional UI for that path.

## 6. States and edges

- **Repeat visit**: no card, no banner; the locate button is the only
  geolocation surface.
- **Offline first visit**: card still renders (city picker is local); the
  `Enable location` action stays available (geolocation is a browser API,
  not network) but nearby content follows the global offline treatment.
- **Reduced motion**: card appears instantly; the recenter beat becomes an
  immediate jump; the locate pulse is suppressed.

## 7. Accessibility and i18n

- Card is `role="dialog"` labelled by its headline but **non-modal**: no
  focus trap, focus is not moved on mount (the map is the point); tab order
  reaches the card after the map controls.
- Permission outcomes are announced via the toast's polite live region.
- Keys under `onboarding.*`. zh references (spec-seeded): `Enable location`
  → `开启定位`, `Skip for now` → `暂时跳过`, `Looks like you're in {city}` →
  `看起来你在 {city}`, `Location is off — pick your city` →
  `定位未开启 — 请选择城市`, `Find a cafe you can actually work in` →
  `找到真正能办公的咖啡馆`.

## 8. Visual acceptance criteria (owner sign-off)

- [ ] The map is visible and alive behind the welcome card — no tunnel.
- [ ] Two choices, one card: permission, or city + skip.
- [ ] Denied permission degrades gracefully without red error styling.
- [ ] The locate button never collides with the FAB or the sheet handle on
      390px mobile, and sits clear of the sidebar on desktop.
- [ ] No tour, no carousel, no emoji.
- [ ] Dark mode requires no per-component overrides.

## Out of scope

Deep-link banner composition (seo-sharing-v1), the search city-scope chip
(search-filters-v1), server-side storage/merge of location and city
(spec-owned), map markers and map chrome (`map-home`).
