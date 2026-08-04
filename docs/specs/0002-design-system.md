# 0002. Design System Spec

## Goal

Define CoffeeMode's visual identity for 2026: modern, restrained, elegant. The coworking review platform for digital nomads — it must feel designed by someone with taste, not a template, not retro, not generic, and absolutely not vibe-coded. Built on HeroUI v3 + Tailwind v4 + Framer Motion. All copy internationalized (next-intl, en + zh) from day one.

## Status

Accepted (revised 2026-08-02 — supersedes retro/vintage direction; aligned with bottom-sheet SPA, swipe cards, slider check-in)

## Stable decisions

```text
- HeroUI v3 + Tailwind v4 + Framer Motion
- next-intl from day one (en primary, zh secondary)
- Map-native SPA: bottom sheet (peek/half/full) + horizontal swipe cards
- All scoring = subjective 0-100 sliders; Work Profile bars are the visual hero
- Anti-vibe-coding: no confetti, no purple gradients, no glass-panel AI-slop
```

## Design personality

```text
modern, not retro
restrained, not flashy
elegant animation, not bouncy
color-confident, not muted
2026 designer sensibility
map-native, spatial thinking
coffee-aware without being kitsch
```

CoffeeMode should feel like a beautifully designed city guide by a studio that also does brand identity — precise typography, confident color, purposeful motion. Not a "coffee theme" with bean icons and kraft paper textures.

## Anti-patterns (explicitly avoid)

```text
Retro/vintage coffee:
  kraft paper textures, bean icons, chalkboard fonts,
  sepia tones, "artisanal" hand-drawn elements,
  warm-beige-everything, nostalgic serif overload

Material Design defaults:
  generic elevation, ripples, standard card grids,
  default Roboto, floating action buttons without context

2024-2026 vibe-coded AI UI:
  purple-blue gradients, glass panels, glowing orbs,
  sparkle decoration, ubiquitous pills, uppercase eyebrows,
  oversized rounded cards

Generic SaaS:
  sidebar + table, admin-console feel,
  cold blue-gray palettes, corporate stock imagery
```

## Component library — HeroUI v3

```text
Library: @heroui/react 3.2+ (formerly NextUI)
Styling: Tailwind CSS v4 (@plugin integration)
Animation: Framer Motion (built-in, tuned springs)
Dark mode: semantic tokens + next-themes (class strategy)
A11y: React Aria under the hood
```

### Why HeroUI over Shadcn

```text
- Built-in Framer Motion animation (tuned, restrained springs)
- Drawer component = slide-over panels (native, no DIY)
- Autocomplete with virtualizer (cafe search)
- Cohesive design language out of the box
- 11 brand themes prove customizability (Netflix, Spotify, Airbnb...)
- Faster time-to-beautiful for a small team
```

### Custom components (bespoke, on top of HeroUI)

```text
MapCanvas:        MapKit JS full-screen map (client component)
CafeMarker:       Coffee-cup marker (existing design) + open/closed status dot
CafeCard:         Horizontal swipe card (~85% width, snap carousel)
BottomSheet:      Google-Maps-style sheet, snap states peek / half / full
WorkProfile:      Dimension bars (wifi/outlets/seats/temp/coffee) + policy consensus
ScoreSlider:      0-100 subjective slider with live value (check-in + creation)
PolicyChips:      min-spend / max-stay chip groups
NavPrompt:        ClassPass-style "Did you visit?" slide-up card
DeepLinkBanner:   Lightweight bottom banner for deep-link first visits
```

## Theme tokens

### Color system

HeroUI semantic tokens overridden with CoffeeMode palette. The palette is warm-neutral but confident — not muted, not beige.

```text
Light mode:
  background:     oklch(98.0% 0.003 85)    near-white warm
  foreground:     oklch(20.0% 0.020 55)    deep espresso ink
  content1:       oklch(99.5% 0.002 85)    elevated surface
  content2:       oklch(96.0% 0.008 80)    secondary surface
  content3:       oklch(93.0% 0.012 75)    tertiary / hover
  content4:       oklch(88.0% 0.015 70)    borders, dividers

  primary:        oklch(55.0% 0.140 45)    burnt sienna / terracotta
  primary-fg:     oklch(98.0% 0.005 85)    white on primary
  secondary:      oklch(45.0% 0.080 155)   deep sage green
  secondary-fg:   oklch(97.0% 0.005 155)   white on secondary

  success:        oklch(55.0% 0.100 155)   sage green
  warning:        oklch(65.0% 0.130 75)    amber
  danger:         oklch(50.0% 0.150 25)    clay red

Dark mode:
  background:     oklch(15.0% 0.012 55)    deep espresso
  foreground:     oklch(93.0% 0.008 75)    warm light
  content1:       oklch(19.0% 0.012 55)    elevated
  content2:       oklch(23.0% 0.012 55)    secondary
  content3:       oklch(28.0% 0.012 55)    tertiary
  content4:       oklch(35.0% 0.010 55)    borders

  primary:        oklch(62.0% 0.130 50)    lighter terracotta
  secondary:      oklch(55.0% 0.080 155)   lighter sage
```

### Typography

```text
UI/body:     "Inter" variable (or system-ui fallback)
Display:     "Satoshi" or "Cabinet Grotesk" (geometric, modern)
Mono:        "JetBrains Mono" (coordinates, hours, metadata)
```

Rules:

```text
- Self-host all fonts (no runtime Google Fonts)
- Display font for page titles and cafe names only
- Body and UI labels in Inter/system sans
- Tabular numerals for ratings, distances, counts
- Fixed type scale, no oversized marketing type in-app
```

Type scale:

```text
text-xs    0.75rem   metadata, coordinates, timestamps
text-sm    0.8125rem secondary labels, tags
text-base  0.875rem  default body, navigation
text-md    1.0rem    card titles, list headings
text-lg    1.25rem   section headings
text-xl    1.5rem    page titles
text-2xl   2.0rem    hero/display (landing only)
```

### Spacing and radius

```text
spacing unit:  4px base grid
radius-sm:     8px    tags, small buttons, chips
radius-md:     12px   cards, inputs
radius-lg:     16px   modals, drawers, sheets
radius-xl:     24px   hero cards, map overlays (sparingly)
radius-full:   only for true pill/avatar controls
```

Generous whitespace. Cards breathe. Map overlays float with purpose.

### Elevation

```text
Prefer borders + tonal separation over shadows.
Map overlays: backdrop-blur(12px) + subtle warm shadow
Cards: 1px border (content4) + shadow-sm on hover
Drawers/modals: shadow-lg, warm-tinted
Avoid: broad decorative shadows, Material elevation stacks
```

Shadow tokens:

```text
shadow-sm   0 1px 3px oklch(15% 0.01 55 / 0.05)
shadow-md   0 4px 12px oklch(15% 0.01 55 / 0.08)
shadow-lg   0 8px 24px oklch(15% 0.01 55 / 0.12)
shadow-map  0 4px 20px oklch(15% 0.01 55 / 0.15)
```

## Motion

Framer Motion powers all animation (via HeroUI built-in + direct usage).

```text
motion.feedback    120ms   button press, toggle, chip select
motion.state       200ms   card expand, drawer slide
motion.transition  300ms   page transition, map overlay enter
motion.slow        450ms   onboarding, first-load reveal

ease.default       [0.22, 1, 0.36, 1]     ease-out-quint
ease.spring        HeroUI scaleSpring      restrained bounce (sparingly)
ease.smooth        [0.4, 0, 0.2, 1]       standard material-like
```

### Signature moments

```text
- Map marker tap → sheet rises peek → half (velocity-aware, HeroUI Drawer)
- Swipe cards: smooth scroll snap + subtle parallax on cover image;
  active card scales ~1.02, neighbors dim slightly — eye-catching but restrained
- Check-in confirm: button morphs to ✓ + micro coffee-steam animation + toast
  (detailed visual design handed to Kimi; must avoid confetti/AI-slop feel)
- Slider drag: live value + haptic-style scale on thumb; dimension bars animate on load
- Filter apply: results reflow with layout animation (Framer layoutId)
- Navigation prompt: slide-up card, auto-collapse to pill after 8s
- Deep-link banner: gentle rise, never blocks content
```

### Rules

```text
- Every animation has prefers-reduced-motion fallback
- Enter: 200-300ms spring. Exit: 100-150ms (faster out than in)
- No animation longer than 450ms in normal flow
- Map interactions: immediate (no artificial delay)
- Loading: skeleton shimmer (HeroUI Skeleton), not spinners
```

## Layout

Mobile-first, map-native:

```text
Mobile:
  Full-screen Apple Map (dark mode follows theme)
  Floating search bar (top, backdrop-blur)
  Bottom sheet — Google Maps style, one sheet three states:
    PEEK  horizontal swipe cards (cafes in viewport, synced with map)
    HALF  selected cafe: cover carousel + name + actions + top work facts
    FULL  complete detail; map stays visible ~15% at top
  URL sync: HALF/FULL → /cafes/[id] via replaceState; back collapses
  FAB bottom-right (add cafe, login-gated)
  Check-in: drawer above the sheet

Desktop:
  Left sidebar 380px: search + filters + cafe list (scroll)
  Right: full-screen map
  Cafe detail: slide-over from right (Drawer placement="right")
  Or: dedicated page /cafes/[id] (SSR, shareable)

Breakpoints:
  sm: 640px   (large phone landscape)
  md: 768px   (tablet — switch to sidebar layout)
  lg: 1024px  (desktop)
  xl: 1280px  (wide desktop)
```

## Dark mode

```text
Strategy: next-themes, class="dark" on <html>
Default: follow system preference (prefers-color-scheme)
Toggle: available in header (sun/moon icon)
Map: MapKit JS colorScheme toggles in sync with theme
Images: no dimming (photos should look true)
Transition: 200ms color transition on theme switch
```

## Accessibility

```text
- Body text contrast >= 4.5:1 (both themes)
- Large text contrast >= 3:1
- Map markers: text alternatives via aria-label
- Bottom sheet / Drawer: keyboard navigable, focus trapped
- Fact chips: toggle button semantics (aria-pressed)
- Filter controls: visible focus states
- Empty/loading/error states: designed, not raw text
- Color never the only signal (icon + text accompany status)
- Rating: not just dots — include numeric value (aria-label)
```

## Acceptance criteria

```text
- Swipe cards and bottom sheet feel premium and eye-catching without vibe-coding tells
- Work profile bars + score sliders are the visual hero of the cafe detail
- UI feels like a 2026 design studio portfolio piece
- No retro/vintage coffee aesthetic anywhere
- HeroUI components are themed with CoffeeMode tokens (no default blue)
- Animation is restrained and elegant — springs, not bounces
- Dark mode is a true espresso theme with warm undertones
- Map (Apple Maps dark) feels integrated, not embedded
- Mobile layout is map-native with bottom sheet
- Desktop layout has proper sidebar + map split
- Framer Motion layout animations on list reflow
- All interactive elements have hover/focus/active states
- prefers-reduced-motion disables all non-essential animation
- No Material Design, generic SaaS, or AI-slop visual language
```
