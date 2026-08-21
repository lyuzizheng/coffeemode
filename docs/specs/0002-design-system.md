# 0002. Design System Spec

## Goal

Define CoffeeMode's visual identity for 2026: modern, restrained, elegant. The coworking review platform for digital nomads — it must feel designed by someone with taste, not a template, not retro, not generic, and absolutely not vibe-coded. Built on HeroUI v3 + Tailwind v4 + Framer Motion. All copy internationalized (next-intl, en + zh) from day one.

## Status

Accepted (revised 2026-08-21 — display-font rule clarified: screen titles + brand wordmark permitted, data/numbers/state labels excluded (DG22); desktop cafe detail becomes a second left column, not a right drawer (DG42); PEEK cards gain a low-contrast Work-score watermark (DG43); FAB creation composes logged-out, sign-in at publish (DG39); 2026-08-20 — discovery feed, recovery, focus, reduced-motion, missing-cafe, breakpoint, and gesture constraints; 2026-08-19 — Kimi K3 design authority and responsive discovery contract; earlier 2026-08-02 — supersedes retro/vintage direction, aligned with bottom-sheet SPA, swipe cards, slider check-in)

## Stable decisions

```text
- HeroUI v3 + Tailwind v4 + Framer Motion (no Shadcn; HeroUI is the sole component library)
- next-intl from day one (en primary, zh secondary)
- Responsive map-native discovery: mobile bottom sheet + swipe cards; desktop sidebar + second-level detail column
- All scoring = subjective 0-100 sliders; Work Profile bars are the visual hero
- Anti-vibe-coding: no confetti, no purple gradients, no glass-panel AI-slop
- Global toast surface: HeroUI <Toast.Provider> mounted in root providers
- Every new user-visible UI slice requires a Kimi K3 design artifact before
  implementation; agents implement the approved composition rather than inventing it
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
Library: @heroui/react 3.2+ (formerly NextUI) — the only component library in use
Styling: Tailwind CSS v4 (@plugin integration)
Animation: Framer Motion (built-in, tuned springs)
Dark mode: semantic tokens + next-themes (class strategy)
A11y: React Aria under the hood
```

Do not add Shadcn, Radix primitives, or a `components/ui` directory. Bespoke components are built on top of HeroUI.

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
CafeCard:         Horizontal swipe card (~85% width, snap carousel); compact
                  characteristic icons expose wifi, outlets, stay limit, and
                  other available work facts without turning PEEK into detail
BottomSheet:      Google-Maps-style sheet, snap states peek / half / full
WorkProfile:      Dimension bars (wifi/outlets/seats/temp/coffee) + policy consensus
ScoreSlider:      0-100 subjective slider with live value (check-in + creation)
PolicyChips:      min-spend / max-stay chip groups
NavPrompt:        ClassPass-style "Did you visit?" slide-up card
DeepLinkBanner:   Lightweight bottom banner for deep-link first visits
```

## Theme tokens

### Color system

HeroUI v3 semantic tokens overridden with the CoffeeMode palette. In HeroUI v3 the brand color is `--accent` (v2 called it `--primary`). The palette is warm-neutral but confident — not muted, not beige. `secondary` is a real brand sage, not a status color.

```text
Light mode:
  background:       oklch(98.1% 0.004 82)    warm paper
  foreground:       oklch(23% 0.022 48)      deep espresso ink
  surface:          oklch(99.4% 0.002 82)    elevated surface (cards)
  surface-secondary: oklch(96.4% 0.006 76)   secondary surface
  surface-tertiary: oklch(93.2% 0.009 72)    tertiary / hover
  overlay:          oklch(99.6% 0.002 82)    popovers, modals, sheets
  border:           oklch(89.5% 0.008 70)    component borders
  separator:        oklch(92.5% 0.006 74)    dividers
  muted:            oklch(44% 0.02 55)       secondary text
  default:          oklch(94% 0.007 72)      neutral controls

  accent:           oklch(54% 0.15 42)       burnt sienna / terracotta
  accent-foreground: oklch(98.5% 0.004 80)   white on accent
  secondary:        oklch(45.0% 0.080 155)   deep sage green (brand)
  secondary-foreground: oklch(97.0% 0.005 155) white on secondary

  success:          oklch(52% 0.11 152)      sage green status
  success-foreground: oklch(98% 0.01 140)
  warning:          oklch(66% 0.14 68)       amber
  warning-foreground: oklch(26% 0.03 55)
  danger:           oklch(50% 0.17 26)       clay red
  danger-foreground: oklch(98.5% 0.004 60)

Dark mode:
  background:       oklch(15.5% 0.012 50)    deep espresso
  foreground:       oklch(92.5% 0.009 72)    warm light
  surface:          oklch(19.5% 0.013 52)    elevated surface
  surface-secondary: oklch(23% 0.013 52)     secondary surface
  surface-tertiary: oklch(27.5% 0.013 52)    tertiary / hover
  overlay:          oklch(22% 0.014 52)      popovers, modals, sheets
  border:           oklch(29.5% 0.012 52)    warm hairline borders
  separator:        oklch(25% 0.012 52)      dividers
  muted:            oklch(72% 0.015 60)      secondary text
  default:          oklch(26.5% 0.013 52)    neutral controls

  accent:           oklch(68% 0.16 46)       lighter terracotta
  accent-foreground: oklch(17% 0.015 48)
  secondary:        oklch(55.0% 0.080 155)   lighter sage (brand)
  secondary-foreground: oklch(16% 0.03 150)

  success:          oklch(70% 0.13 150)
  success-foreground: oklch(16% 0.03 150)
  warning:          oklch(76% 0.14 75)
  warning-foreground: oklch(24% 0.04 60)
  danger:           oklch(64% 0.19 27)
  danger-foreground: oklch(97% 0.01 60)
```

`web/app/globals.css` maps `--color-secondary` / `--color-secondary-foreground` in `@theme` and overrides `--accent`, `--accent-foreground`, `--secondary`, `--secondary-foreground`, plus `surface`, `border`, `separator`, `muted`, and `default` in both `:root` (light) and `.dark` so the brand palette is available through HeroUI semantic tokens.

### Typography

```text
UI/body:     "Inter" variable (or system-ui fallback)
Display:     "Satoshi" or "Cabinet Grotesk" (geometric, modern)
Mono:        "JetBrains Mono" (coordinates, hours, metadata)
```

Rules:

```text
- Self-host all fonts (no runtime Google Fonts)
- Display font for page/screen titles, the brand wordmark, and cafe names
  only — never for data, numbers, or component state labels
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
radius-sm:     2px    tags, small buttons, chips
radius-md:     4px    cards, inputs
radius-lg:     6px    modals, drawers, sheets
radius-xl:     8px    hero cards, map overlays (sparingly)
radius-full:   only for true pill/avatar controls
```

Dense, mobile-first radius. Cards breathe through padding, not roundness. `web/app/globals.css` must codify `--radius-sm/md/lg/xl` and pin `.card` to `--radius-md`.

### Elevation

```text
Prefer borders + tonal separation over shadows.
Map overlays: backdrop-blur(12px) + subtle warm shadow
Cards: 1px border (--border) + shadow-surface on default, shadow-md on hover
Drawers/modals: shadow-lg, warm-tinted
Avoid: broad decorative shadows, Material elevation stacks
```

Shadow tokens (warm espresso ink, never pure black):

```text
shadow-sm:   0 1px 2px 0 oklch(25% 0.03 50 / 0.05)
shadow-md:   0 1px 2px 0 oklch(25% 0.03 50 / 0.04),
             0 4px 12px -2px oklch(25% 0.03 50 / 0.07)
shadow-lg:   0 2px 4px 0 oklch(25% 0.03 50 / 0.04),
             0 12px 28px -6px oklch(25% 0.03 50 / 0.12)
shadow-map:  0 1px 3px 0 oklch(25% 0.03 50 / 0.06)
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
- Feed refresh/pagination: preserve the last successful content and put an inline
  error + Retry at the failed section; never replace real cards with placeholders
```

## Layout

Mobile-first, map-native:

```text
Mobile:
  Full-screen Apple Map (dark mode follows theme)
  Floating search bar (top, backdrop-blur)
  Bottom sheet — Google Maps style, one sheet three states:
    PEEK  no selection; horizontal swipe cards with compact work-characteristic
          icons and a low-contrast Work-score watermark numeral (DG43)
    HALF  selected cafe: cover carousel + name + both scores + actions + top work facts
    FULL  complete real-data detail with Helpful/Newest feed modes;
          map stays visible ~15% at top
  URL sync: first selection pushes /cafes/[id]; selection/height changes replace it;
            Back collapses the whole selection session to /
  Gesture: downward drag steps FULL → HALF → PEEK; Close/Back clears to PEEK
  Drag ownership: handle/header moves the sheet; content scrolls and hands off
                  downward movement only when content is already at scroll-top
  FAB bottom-right (add cafe; composing works logged-out, sign-in at publish — DG39)
  Check-in: drawer above the sheet

Desktop:
  Left sidebar 380px: search + filters + cafe list (scroll)
  Center-right: full-screen map
  Cafe detail: second left column immediately right of the sidebar (DG42);
               the map fills the remaining width — no right-side drawer
  Activates at 1024px and uses the shared selection/URL state; never emulates
  mobile PEEK/HALF/FULL snaps
Deep-link/share landing: dedicated SSR /cafes/[id] in the separate seo-sharing slice

Breakpoints:
  sm: 640px   (large phone landscape)
  md: 768px   (tablet — mobile sheet remains active)
  lg: 1024px  (desktop — switch to sidebar + detail column)
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
- Discovery sheet / Drawer: keyboard navigable and non-modal; no focus trap
- Cafe selection focuses the detail heading; Close restores the source-card focus
- Reduced motion: sheet snaps and drawer state changes complete immediately
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
- No Shadcn components; HeroUI v3 is the sole library
- Kimi K3 design artifact exists for the slice and the implementation matches it
- Kimi K3 defines the Helpful/Newest control composition within the accepted behavior
- Kimi K3 defines the visual treatment for accepted Retry/toast/focus states and
  validates the mobile-sheet composition through tablet landscape
- `web/app/globals.css` implements accent, secondary, radius, and shadow tokens exactly
- HeroUI `<Toast.Provider>` is mounted in root providers
```
