# 0002. Design System Spec

## Goal

Define CoffeeMode's visual design direction for 2026: a modern, warm-yet-precise cafe discovery experience that feels crafted, not template-generated. Replace the current generic Shadcn defaults with a distinctive identity.

## Status

Accepted

## Stable decisions

### Design personality

Keywords:

```text
warm but not nostalgic
modern but not trend-led
spatial and map-native
inviting and sensory
precise but not corporate
community-driven
coffee-culture aware
```

CoffeeMode should feel like a beautifully curated city guide written by someone who actually works from cafes — not a generic maps app, not a Yelp clone, not a Material Design template, not a vibe-coded AI product.

## Anti-template guardrails

CoffeeMode must explicitly avoid:

```text
Material Design defaults:
  generic elevation, ripples, floating action buttons without context,
  standard card grids, default Roboto typography

2024-2026 vibe-coded AI UI:
  purple-blue gradients, glass panels, glowing orbs,
  sparkle decoration, ubiquitous pills, repeated uppercase eyebrows,
  oversized rounded cards, generic card grids

Generic SaaS dashboard:
  sidebar + table layout, admin-console feel,
  cold blue-gray palettes, corporate stock imagery
```

## Theme direction

CoffeeMode uses a warm-neutral base with coffee-inspired accents and strong spatial/map awareness.

Physical scene:

```text
A person opens CoffeeMode on their phone or laptop in a cafe,
looking for their next work spot. The interface feels like
a well-designed field guide — warm, tactile, informative,
with map-native spatial thinking built into every surface.
```

Structure:

```text
Warm paper/cream base for content surfaces (not the AI-default beige)
Deep espresso for text and navigation chrome
Caramel/amber for primary actions and highlights
Sage green for positive states (open, available, good wifi)
Terracotta for warnings and attention
Map-native: the map IS the interface, not a background
```

## Version-1 palette

```text
color.base.paper        oklch(97.0% 0.008 85.0)   #F7F4EF  warm paper white
color.base.surface      oklch(99.0% 0.004 85.0)   #FCFBF9  elevated surface
color.base.warm         oklch(93.5% 0.015 75.0)   #EDE6DA  warm muted bg

color.ink.espresso      oklch(22.0% 0.020 55.0)   #2C2118  primary text
color.ink.mocha         oklch(42.0% 0.025 55.0)   #5C4A3A  secondary text
color.ink.latte         oklch(62.0% 0.020 60.0)   #9A8672  muted text

color.accent.caramel    oklch(58.0% 0.120 65.0)   #B87A3D  primary action
color.accent.caramelDk  oklch(48.0% 0.110 60.0)   #8F5E2C  hover/active

color.signal.sage       oklch(55.0% 0.080 155.0)  #4A8B62  positive/open
color.signal.terracotta oklch(55.0% 0.120 40.0)   #B85A3A  warning/attention
color.signal.clay       oklch(45.0% 0.100 25.0)   #8B3A2A  error/destructive

color.map.water         oklch(88.0% 0.030 230.0)  #C8D8E4  map water
color.map.park          oklch(88.0% 0.040 145.0)  #C4DEC8  map green space
color.map.road          oklch(94.0% 0.005 85.0)   #F0EDE8  map roads
```

Dark mode inverts to espresso-base with warm-light text:

```text
color.base.paper    -> oklch(18.0% 0.015 55.0)   #241C14
color.base.surface  -> oklch(22.0% 0.015 55.0)   #2E2419
color.ink.espresso  -> oklch(92.0% 0.010 75.0)   #E8E0D4
color.accent.caramel-> oklch(65.0% 0.110 65.0)   #C89050
```

## Typography

```text
UI hierarchy/body: "Instrument Sans" or "Inter" variable sans
Display/headings:  "Fraunces" (optical sizing, warm serif character)
Machine metadata:  "JetBrains Mono" or system mono for coordinates, hours
Numbers:           tabular numerals for ratings, distances, counts
```

Rules:

```text
- self-host font files; no runtime Google Fonts dependency
- Fraunces for page titles and cafe names only — not body text
- keep UI labels and body in the sans family
- use tabular numerals for ratings, distances, review counts
- fixed type scale, no giant marketing typography in-app
```

Type scale:

```text
text.xs    0.72rem  metadata, coordinates, timestamps
text.sm    0.80rem  secondary labels, tags
text.base  0.88rem  default body and navigation
text.md    1.00rem  card titles, list headings
text.lg    1.20rem  section headings
text.xl    1.50rem  page titles
text.2xl   2.00rem  hero/display (landing only, not in-app)
```

## Spacing and radius

```text
spacing.unit   4px base grid
radius.sm      6px   tags, small buttons
radius.md      10px  cards, inputs
radius.lg      14px  modals, sheets
radius.xl      20px  hero cards, map overlays
radius.pill    only for true pill/tag controls
```

Prefer generous whitespace. Cafe cards should breathe. Map overlays should feel like they float above the map with purpose, not generic drop shadows.

## Elevation and material

```text
Use borders and tonal separation before shadows.
Map overlays: subtle backdrop-blur + warm shadow (not gray)
Cards: 1px warm border + minimal shadow
Sheets/modals: warm shadow-lg, no cold gray
Avoid: broad decorative shadows, Material elevation stacks
```

Shadow tokens:

```text
shadow.sm   0 1px 3px oklch(22% 0.02 55 / 0.06)
shadow.md   0 4px 12px oklch(22% 0.02 55 / 0.08)
shadow.lg   0 8px 24px oklch(22% 0.02 55 / 0.12)
shadow.map  0 4px 20px oklch(22% 0.02 55 / 0.15)  for map overlays
```

## Motion

```text
motion.feedback    120ms  button press, toggle
motion.state       200ms  card expand, sheet slide
motion.transition  300ms  page transition, map overlay enter
motion.slow        400ms  onboarding, first-load reveal
ease.default       cubic-bezier(0.22, 1, 0.36, 1)  ease-out-quint
ease.spring        cubic-bezier(0.34, 1.56, 0.64, 1)  playful bounce (sparingly)
```

Signature moments:

```text
- Cafe card carousel: smooth spring scroll snap
- Map marker -> detail: shared element transition (View Transitions API)
- Bottom sheet: drag with velocity-aware snap points
- Filter apply: results reflow with FLIP animation
- Check-in: satisfying micro-animation (coffee cup fill?)
```

Every motion needs a `prefers-reduced-motion` fallback.

## Component strategy

```text
Shadcn UI as primitive foundation (already in use)
Override ALL default Shadcn tokens with CoffeeMode palette
Custom components for map-native patterns:
  - MapOverlay (floating panel above map)
  - CafeMarker (custom map pin with amenity icons)
  - BottomSheet (draggable, snap points)
  - AmenityBadge (icon + label pill)
  - RatingDots (coffee-bean rating display, not generic stars)
```

## Layout

Mobile-first, map-native:

```text
Mobile:
  Full-screen map
  Floating search bar (top)
  Draggable bottom sheet (cafe list)
  FAB for add place (bottom-right)

Desktop:
  Left: sidebar with search, filters, cafe list (380px)
  Right: full map
  Cafe detail: slide-over panel or dedicated page
```

## Accessibility

```text
- Body text contrast >= 4.5:1
- Large text contrast >= 3:1
- Map markers have text alternatives
- Bottom sheet is keyboard-navigable
- Filter controls have visible focus states
- Empty/loading/error states are designed, not raw text
- Color is never the only signal (icons + text accompany status)
```

## Acceptance criteria

```text
- UI looks like a curated cafe guide, not a Shadcn demo or maps template
- Warm palette is consistent across all surfaces
- Fraunces display font gives distinctive character to headings
- Map feels like the primary interface, not a background widget
- Dark mode is a true espresso theme, not inverted defaults
- Motion follows the accepted rhythm with reduced-motion fallbacks
- All Shadcn components are re-themed, none show default blue/gray
- Mobile layout is map-native with bottom sheet pattern
- No Material Design, generic SaaS, or vibe-coded AI visual language
```
