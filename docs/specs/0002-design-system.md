# 0002. Design System Spec

## Goal

Define CafeMood's visual identity for 2026: modern, restrained, elegant. The coworking review platform for digital nomads — it must feel designed by someone with taste, not a template, not retro, not generic, and absolutely not vibe-coded. Built on HeroUI v3 + Tailwind v4 + Framer Motion. All copy internationalized (next-intl, en + zh) from day one.

### Product positioning & identity core (定位定义与核心原则, BRAWUKA-69 settled)

CafeMood is strictly an **artisan information tool (文艺范的信息工具)**, NOT a reading, publishing, or podcast platform.
- **Utility first (信息工具属性优先)**: Core mission is solving the user's immediate real-world problem with zero friction — finding specialty cafes, verifying WiFi/outlets/laptop-friendliness (Work Profile index), and completing a 3-second check-in. Speed, information density, and low-cognitive-load navigation are the non-negotiable structural foundation.
- **Artisan aesthetics, anti-AI vibe coding (文艺范有质感，拒绝 AI Vibe Coding)**: CafeMood rejects the statistical mediocrity of generative AI interfaces (no purple/blue cyber glows, no glassmorphic panels, no dead Bento grids, no default Inter sans-serif mono-culture). Instead, human craftsmanship is conveyed through warm paper substrate, disciplined dual-plate spot printing, organic typographic breathing, and tactile spring physics.
- **Strict scope boundaries (严守工具边界)**: Check-in notes remain concise and functional (≤500 chars). The design system strictly forbids long-form prose feeds, parallax or footnote-style marginalia reading flourishes on check-in notes, or self-indulgent publishing bloat. (The static marginalia layout column in §Editorial grid is a layout device, not a reading flourish, and remains permitted.) Artisan texture is the skin and breath; it must never eclipse or obstruct utility efficiency.

This spec implements principle 6 (Exquisite Aesthetics / Zero Ugly Things) of
`docs/specs/0000-founder-manifesto.md`, which is the higher-precedence
authority: the anti-ugly invariants below reaffirm the founder's manifesto —
warm espresso + secondary sage palette, dense 2px-8px radius, `text-2xl`
ceiling, first-class skeleton/empty/error states — and every design decision
must pass the manifesto's Interaction gate (怎么交互) before shipping.
## Status

Accepted (corrected 2026-09-06 — BRAWUKA-74 Option 2 superseded by Owner ruling: digital garden NOT applicable as a product surface; CafeMood remains a pure tool; profile notes-collection slice removed; reading-surface gate tightened to explicit-Owner-ruling; revised 2026-09-06 — Founder final settlement on BRAWUKA-69: Product positioning affirmed as artisan information tool (文艺范的信息工具), strictly rejecting reading/podcast/publishing platform creep; anti-AI vibe coding craftsmanship locked; revised 2026-09-06 — BRAWUKA-69 human craftsmanship & editorial reset: typography dual ramp & variable serif (--font-serif), spring-first motion tokens & settle budgets, dual-plate printing discipline (plate roles) & --grain material overlay, editorial surfaces & check-in prose, anti-pattern harmonization; 2026-09-06 — digital-garden editorial scope settled (BRAWUKA-74): lightweight fulfillment via notes ecosystem; standalone Stories surface rejected; post-map profile notes-collection slice registered; revised 2026-09-01 — references 0000-founder-manifesto as the higher-precedence aesthetic authority (#288); 2026-08-22 — copy tone principle 热情真诚: warm, sincere, cute, never commercial (DG87); 2026-08-21 — viewport & safe-area contract: dvh/svh units…; revised 2026-09-18 — BRAWUKA-473 density-consistency pass: concentric radius rule, chip density standards, 44px hit-area floor, list-title/label/error-title type pairing, skeleton-geometry fidelity, and layout constants single-sourced in lib/layout.ts codified in §Spacing and radius

## Stable decisions

```text
- Product positioning invariant: CafeMood is strictly an artisan information tool (文艺范的信息工具), NOT a reading/publishing/podcast platform. Utility and information efficiency (finding cafes, laptop-friendliness, 3s check-in) is the foundation; human craftsmanship, paper substrate, and anti-AI-vibe-coding aesthetics are the sensory surface (BRAWUKA-69 settled)
- HeroUI v3 + Tailwind v4 + Framer Motion (no Shadcn; HeroUI is the sole component library)
- next-intl from day one (en primary, zh secondary)
- Responsive map-native discovery: mobile bottom sheet + swipe cards; desktop sidebar + second-level detail column
- All scoring = subjective 0-100 sliders; Work Profile bars are the visual hero
- Anti-vibe-coding: no confetti, no purple gradients, no glass-panel AI-slop
- Global toast surface: HeroUI <Toast.Provider> mounted in root providers
- Every new user-visible UI slice requires a Kimi K3 design artifact before
  implementation; agents implement the approved composition rather than inventing it
- Dual typography scales: isolated App ramp (xs-2xl) and Editorial ramp (prose/lede/section/display+opsz); --font-serif for narrative reading, forbidden on utility chrome (BRAWUKA-69)
- Spring-first motion: settle budgets (150ms/300ms/450ms) replace fixed durations; soft/gentle/snappy presets from lib/motion.ts codified as tokens (BRAWUKA-69)
- Dual-plate printing discipline: substrate + espresso ink (≥70%) + terracotta spot + sage secondary (≤30%); --grain SVG noise material overlay bound to WCAG AA contrast gate (BRAWUKA-69)
- Digital garden (manifesto §4) is NOT fulfilled as a product surface —
  CafeMood stays a pure tool (Owner ruling 2026-09-06, BRAWUKA-74)
- Field-guide direction (BRAWUKA-364, Owner unrestricted redesign): the app
  reads as a printed field guide to workable cafes — masthead wordmark +
  tagline, hairline-ruled index rows with monogram plates, mono-plate
  scores, dossier detail with section labels, floating capsule search on
  mobile, round add-cafe FAB, cover-style welcome card. All within the
  existing token system; no new colors, no radius above --radius-lg.
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
artisan information tool, not a reading platform
tactile human craftsmanship, not AI statistical mediocrity
```

CafeMood should feel like a beautifully designed city guide by a studio that also does brand identity — precise typography, confident color, purposeful motion. Not a "coffee theme" with bean icons and kraft paper textures.

## Anti-patterns (explicitly avoid)

```text
Retro/vintage coffee kitsch:
  kraft paper textures, bean icons, chalkboard fonts,
  sepia tones, "artisanal" hand-drawn elements,
  warm-beige-everything kitsch, nostalgic decorative serif overload/flourishes
  (Harmonization note: this prohibition targets coffee kitsch and cafe gimmicks.
  It does NOT forbid editorial serif (--font-serif) as a narrative reading voice
  or warm paper substrate as a physical base. Whole-site serif overload, decorative
  flourishes/swashes, and tool surfaces in serif remain strictly forbidden.)

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
PolicyChips:      max-stay chip group (min-spend group removed, DG125)
NavPrompt:        ClassPass-style "有去喝一杯吗？" slide-up card (DG92)
```

## Theme tokens

### Color system

HeroUI v3 semantic tokens overridden with the CafeMood palette. In HeroUI v3 the brand color is `--accent` (v2 called it `--primary`). The palette is warm-neutral but confident — not muted, not beige. `secondary` is a real brand sage, not a status color.

Plate roles (mono-color dual-plate printing discipline):

```text
Plate 0  substrate   background/surface —— physical warm paper, counts as zero ink
Ink 1    dominant    foreground/border/separator —— deep espresso neutral ink (≥70% of colored surface)
Spot     accent      terracotta: actions, focus rings, interactive links, active states
                     —— exactly one focal event per viewport
Plate 2  secondary   sage: strictly limited semantic role = positive work-suitability signals
                     (WorkProfile bars, live open-state dot, "laptop-friendly" tags)
                     —— forbidden as decorative large fills; target colored pixel ratio ≤30% per viewport
Status   status      success/warning/danger —— strictly functional semantics, never decorative
```

Material token (--grain):

```text
--grain: SVG feTurbulence noise overlay
         opacity 0.03–0.05 (light mode) / 0.04–0.06 (dark mode)
         CSS: pointer-events: none; fixed/absolute overlay
         Surfaces: background canvas and editorial/hero surfaces only
         Strict prohibitions: never cover the map canvas; no full-surface color wash;
                              no third decorative hue
         Gate invariant: before-and-after WCAG AA contrast calculation table must show zero regressions
```

Token values:

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
  secondary-hover:  oklch(40.0% 0.080 155)   sage one step toward the ink (BRAWUKA-209)

  success:          oklch(52% 0.11 152)      sage green status
  success-foreground: oklch(98% 0.01 140)
  warning:          oklch(66% 0.14 68)       amber
  warning-foreground: oklch(26% 0.03 55)
  danger:           oklch(50% 0.17 26)       clay red
  danger-foreground: oklch(98.5% 0.004 60)
  danger-solid:     oklch(50% 0.17 26)       filled-button plate; equals danger in light, independent token (BRAWUKA-211)

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

  accent:           oklch(68% 0.16 46)       lighter terracotta (6.27:1 on accent-foreground)
  accent-foreground: oklch(17% 0.015 48)
  secondary:        oklch(58.0% 0.080 155)   lighter sage (brand); 55.0% raised for the AA gate (4.14:1 → 4.69:1, BRAWUKA-130)
  secondary-foreground: oklch(16% 0.03 150)
  secondary-hover:  oklch(62.0% 0.080 155)   sage one step toward the ink; 5.52:1 on secondary-foreground (BRAWUKA-209)

  success:          oklch(70% 0.13 150)
  success-foreground: oklch(16% 0.03 150)
  warning:          oklch(76% 0.14 75)
  warning-foreground: oklch(24% 0.04 60)
  danger:           oklch(70% 0.19 27)       text/border colour only — error copy, liked heart, "closed"; carries dark ink like success/warning (BRAWUKA-219)
  danger-foreground: oklch(16% 0.01 60)
  danger-solid:     oklch(56% 0.19 27)       filled-button plate for white label text — 5.12:1; the roles split because no single L clears AA as both plate and text (BRAWUKA-211)
```

`web/app/globals.css` maps `--color-secondary` / `--color-secondary-foreground` / `--color-secondary-hover` / `--color-danger-solid` in `@theme` and overrides `--accent`, `--accent-foreground`, `--secondary`, `--secondary-foreground`, `--secondary-hover`, `--danger`, `--danger-foreground`, `--danger-solid`, plus `surface`, `border`, `separator`, `muted`, and `default` in both `:root` (light) and `.dark` so the brand palette is available through HeroUI semantic tokens.

### Typography

Font families:

```text
--font-sans:    Inter var
                UI chrome dedicated (buttons, sheet controls, form inputs, navigation)
--font-serif:   Self-hosted variable serif (Source Serif 4 Variable, opsz + wght axes, OFL);
                zh fallback: "Songti SC", "Noto Serif SC", serif
                Purpose: narrative prose (check-in notes, editorial surfaces)
                Constraints: minimum 1rem; strictly forbidden on bottom sheets, forms,
                             buttons, search bars, or other utility/chrome surfaces
--font-display: Cabinet Grotesk (geometric, modern)
                Brand wordmark + screen titles + editorial display headlines
                (if foundry variable cut available swap in, otherwise breathing applies to serif)
--font-mono:    JetBrains Mono var
                Coordinates, timestamps, telemetry, Work-score numeric values, tabular numerals
```

Dual type scale isolation (App ramp vs. Editorial ramp):

```text
App ramp (UI chrome & utility surfaces — strictly isolated from narrative prose):
  text-xs    0.75rem   metadata, coordinates, timestamps
  text-sm    0.8125rem secondary labels, tags
  text-base  0.875rem  default body, navigation
  text-md    1.0rem    card titles, list headings
  text-lg    1.25rem   section headings
  text-xl    1.5rem    page titles
  text-2xl   2.0rem    hero/display (landing only)

Editorial ramp (narrative reading & editorial surfaces only — mutually exclusive with App ramp):
  prose      1.0625rem / 1.75 line-height   narrative reading body
  lede       1.25rem                        introductory paragraph
  section    1.75rem                        editorial section heading
  display    2.5–3.5rem + font-variation-settings opsz   editorial headline
```

Variable breathing (editorial display only):

```text
- wght / opsz axes may subtly modulate continuously with scroll position
- Maximum amplitude ≤ 60 wght units
- Modulation must be continuous; discrete stepped jumps are strictly prohibited
- prefers-reduced-motion degrades immediately to static weight (no breathing)
```

Rules:

```text
- Self-host all fonts (no runtime Google Fonts)
- Display font for page/screen titles, the brand wordmark, cafe names,
  and editorial display headlines only — never for data, numbers, or component state labels
- Body and UI labels in Inter/system sans; narrative reading in Source Serif 4
- Tabular numerals (.tnum) mandatory for ratings, distances, counts, coordinates
- Fixed type scale, no oversized marketing type in-app
- Dual-scale isolation: App ramp never used for long-form narrative prose;
  Editorial ramp never used for in-app utility chrome, forms, or chips
```

### Spacing and radius

```text
spacing unit:  4px base grid
radius-sm:     2px    tags, small buttons, chips, segmented-control segments
radius-md:     4px    cards, inputs, list rows, grouped settings cards,
                      segmented-control tracks
radius-lg:     6px    modals, drawers, sheets, floating map overlays
radius-xl:     8px    hero cards, map overlays (sparingly)
radius-full:   only for true pill/avatar controls
```

Dense, mobile-first radius. Cards breathe through padding, not roundness. `web/app/globals.css` must codify `--radius-sm/md/lg/xl` and pin `.card` to `--radius-md`.

Concentric radius rule (BRAWUKA-473 — the "Apple" rule: nested rounded
corners share a center, so the inner radius is the outer radius minus the
gap between them):

```text
inner_radius = max(0, outer_radius - padding)

- Segmented control: track `rounded-md` + `p-0.5` (2px) + segment
  `rounded-sm` (2px) → inner 4-2=2px. Canonical: profile-tabs,
  FeedModeTabs, ranking-preference-toggle, theme-variant-picker.
- Cards: `rounded-md` (4px) outer; inner media/chips `rounded-sm` (2px)
  with ≥2px gap. `rounded-xl` is reserved for hero cards and floating
  map overlays — never for plain list/setting cards.
- A bordered element must always carry an explicit radius class —
  `border` without `rounded-*` is a defect (square corners read as a bug).
```

Density invariants (BRAWUKA-473 — font size, padding, and control size must
match the surrounding component density):

```text
- Non-interactive chip (read-only fact/badge): `rounded-sm`,
  `px-2.5 py-1`, `text-xs` — canonical: FactChips, PolicyConsensus chips,
  private badge, history city chip, dim-score chips.
- Interactive chip (selectable option): `h-9` + `px-3` + `text-xs`
  `font-medium`, `rounded-sm` — canonical: PolicyChips, provider chips.
- Hit area: every tappable element ≥44px painted or effective height.
  Inline text links reach it via `min-h-11` + negative margin
  (`-my-2.5`/`-my-1.5`) so the visual row stays dense — canonical:
  profile list links, search-results rows, segmented-control segments.
- List-item titles: `font-display text-md font-bold` (16px/700) —
  canonical: cafe-card h3, search-results, profile tab rows.
- Form field labels: `text-sm font-medium` (sliders, required inputs);
  optional-field captions: `text-xs muted` (note, photos).
- Error/empty page titles: `text-2xl` (gone-cafe, generic 404, error).
- Skeletons mirror the real layout's geometry: same radius, padding,
  element count, and approximate heights — a skeleton that does not match
  its surface is a defect (BRAWUKA-420 class).
- Layout geometry lives only in `web/lib/layout.ts` constants
  (SHEET_PEEK_PX, ASIDE_COLUMN_PX, THUMB_PX, CARD_COVER_W_PX,
  ROW_COVER_W_PX/H_PX, CONTENT_MAX_W_PX, MAP_CHROME_OFFSET_PX) exposed as
  `--layout-*` CSS vars — never re-hardcode these numbers in components.
```

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

## Design variants

A second theme axis orthogonal to light/dark (BRAWUKA-370 mechanism,
BRAWUKA-505 full personalities). `data-variant` on `<html>` selects a
complete design direction; the espresso + sage brand plate and the status
tokens stay shared across all variants. Persistence is localStorage-only,
applied pre-paint by the inline bootstrap in `app/layout.tsx` — no flash,
no server round-trip.

Element-level personality (`.tnum` numerals, filled-button elevation) is
expressed as per-variant tokens (`--tnum-family`, `--tnum-variant`,
`--tnum-features`, `--button-shadow`) consumed by single rules — never
per-variant descendant selectors, which would pierce nested
`data-variant` subtrees (picker swatches). The button rule is scoped to
`[data-variant]` subtrees so the default page (no attribute) keeps
explicit `shadow-*` utilities like the create FAB's `shadow-lg`; the
`.tnum` rules stay global with `font-mono` always winning the family.
Each variant block pins the full token set, and `[data-variant="default"]`
re-pins it, so nested scopes are self-contained.

```text
default — this spec, unchanged: dense radius scale (2/4/6/8px),
          Inter chrome, Cabinet display, warm paper plate
retro   — editorial print voice (复古编辑风)
modern  — industrial instrument panel (现代工业 geek 风)
```

### Variant: retro (editorial print)

Personality: a paper-bound city guide. "Nothing" means zero radius, no
pills, no gradients, no glassmorphism — hairline rules and paper-lift
shadows do all the separation work.

```text
Radius:     every --radius-* token = 0 (incl. --radius-full and
            --field-radius); HeroUI internals are token-driven so the
            whole library squares with the scale
Type:       --font-sans/--font-display/--font-serif all resolve to
            Source Serif 4 var → Noto Serif SC var (self-hosted GB2312
            level-1 subset + app copy, ~1.4MB woff2, loaded only for
            retro users rendering CJK) → Songti SC → "Noto Serif SC"
Numerals:   .tnum uses oldstyle-nums + tabular-nums (editorial figure set);
            font-mono stays JetBrains as the deliberate typewriter accent
Shadows:    paper-lift — low spread, low alpha, warm espresso offset
            (sm 0.08 / md 0.07+0.09 / lg 0.07+0.14); filled buttons carry
            shadow-sm; ghost/outline stay flat
Hairlines:  --border/--separator one step lighter than the base plate
Texture:    monochrome feTurbulence grain on the body canvas, baked into
            a data-URI (4% light / 5% dark, inside the --grain budget)
Glass:      backdrop-filter killed variant-wide; translucent overlay
            chrome re-opacifies to --background/--overlay
Dark:       same warm espresso plate; lift shadows out (dark separates
            with hairlines), hairlines soften a step further
Motion:     printing-press springs — stiffer attack, heavier damping,
            shorter travel (gentle 300/36, snappy 500/40, soft 220/32)
```

### Variant: modern (industrial instrument)

Personality: a precision collection dashboard — rounded but systematic,
geek through mono data annotations and blueprint hairlines, not through
candy gloss.

```text
Radius:     concentric scale — inner = outer − gap, so a 2px gap steps
            each level down exactly: xs 6 / sm 10 / md 12 / lg 16 /
            xl 20 / 2xl 16 / 3xl 20 / 4xl 24 / full pill
            (segmented track md 12 + p-0.5 → segment sm 10; card md 12 +
            2px gap → chip sm 10; sheet lg 16 + 4px pad → inner md 12)
Type:       UI stays Inter/Cabinet; the geek voice is systematic mono —
            every .tnum data annotation (scores, distances, counts,
            timestamps) resolves to JetBrains Mono
Neutrals:   cooler plate — light hue 250 (background 97.8%, foreground
            22%), dark graphite hue 250–260 (background 16%, foreground
            92%); accent/sage/status stay shared so brand contrast math
            is unchanged
Shadows:    cooler, tighter — same geometry, hue-260 ink
Texture:    blueprint grid on the body canvas — 44px hairline grid,
            5% light / 7% dark foreground mix, pure CSS (no image request)
Motion:     instrument springs — softer damping lets motion breathe a
            hair more (gentle 260/26, snappy 400/28, soft 180/22)
```

### Variant rules

```text
- Variant blocks are self-contained quadrants: each pins its full neutral
  plate so a scoped subtree (the picker's mini previews) renders that
  variant's light personality even while the page sits in dark
- Dark-scoped variant tokens use :is(.dark, [data-theme="dark"]) so they
  outrank both the base plate and the unscoped variant block
- Springs: components take transitions from useSprings() (lib/motion.ts),
  which returns the active variant's table; the static `spring` export is
  the default-variant table and SSR fallback
- The picker (ThemeVariantPicker) renders each option's mini preview with
  real variant tokens — data-variant scoped to the swatch subtree
- WCAG AA: all four quadrants (2 variants × light/dark) are gated —
  tests/design-tokens-contrast.test.ts merges each variant block onto its
  theme plate and asserts every text pair ≥4.5:1; check:visual renders
  /theme-preview under all three variants × both schemes × both viewports
- Cost: the CJK serif subset downloads only for retro users rendering CJK
  glyphs; grain/grid are data-URI/CSS, zero image requests
```

## Motion

Framer Motion powers all animation (via HeroUI built-in + direct usage).
Default = spring-first physics. The `lib/motion.ts` presets are codified as canonical tokens.

```text
Spring tokens (primary animation driver):
  spring.soft    stiffness 180, damping 26   atmospheric elements (coffee steam, watermark breathing)
  spring.gentle  stiffness 260, damping 30   WorkProfile bars, card reflow, layoutId transitions
  spring.snappy  stiffness 420, damping 32   bottom sheet detent snap, drawers, toggle thumb
                                             (critically damped, zero rebound overshoot)

Bezier curves (restricted to opacity/color cross-fades, short enter/exit
tweens, and the cardInteraction micro-interactions — never layout motion):
  ease.fade      [0.22, 1, 0.36, 1]   ≤200ms duration (cross-fade / color transition only);
                                      spec vocabulary — maps to ease.default in
                                      lib/motion.ts (CSS twin: --ease-default)
  ease.smooth    [0.4, 0, 0.2, 1]     symmetric curve for color/theme cross-fades
                                      (reserved — no current consumer)
  ease.exit      [0.55, 0.06, 0.68, 0.19]   exit/dismissal fades — decelerating-in
                                      reads faster leaving (reserved)

Duration presets (tween lengths for non-spring transitions — each sits
inside its settle budget below):
  duration.feedback    0.12s   button press, toggle, chip select
  duration.state       0.2s    card expand, drawer slide
  duration.transition  0.3s    page transition, map overlay enter
  duration.slow        0.45s   onboarding, first-load reveal — hard ceiling
```

Choreography tokens (named delays/staggers — no site invents its own numbers):

```text
stagger.checkinSuccess   steamA 0.15, steamB 0.23, title 0.2, cafeName 0.3
                         check-in success card: steam puffs, then text
stagger.heroPoster       card 0.12, scoreBar 0.2   theme-preview poster reveal
stagger.workProfile      step 0.04   per-bar cascade on WorkProfile load

ambient.steam            duration 0.4, loop, step 0.1 per wisp
                         looping coffee-steam wisps — ambient loops never
                         settle, so they are exempt from settle budgets but
                         still capped at the 450ms ceiling

cardInteraction.whileHover   y -2 lift on duration.feedback + ease.default —
                             the "alive" hover feel on interactive cards
cardInteraction.whileTap     scale 0.985 press on duration.feedback + ease.default

cardInteraction.active / .inactive   peek-strip affordance: active card
                         scales ~1.02, neighbors dim to 0.6 (spring.gentle)
```

Settle budgets (spring stability ceilings, replacing fixed durations):

```text
settle.feedback    ≤150ms   button press, toggle, chip select settle ceiling
settle.state       ≤300ms   card expand, drawer slide settle ceiling
settle.transition  ≤450ms   page transition, map overlay enter settle ceiling
settle.slow        ≤450ms   onboarding reveal ceiling
```

Component transitions:

```text
- BottomSheet detent snap: snappy spring (stiffness 420, damping 32) + drag velocity pass-through
  (dragMomentum preserved, eliminating rigid bezier tween)
- WorkProfile bars: gentle spring (stiffness 260, damping 30), aligning code with "spring-loaded" spec
- Dark mode theme transition: optical lighting transition across surface hierarchy
  (0ms base / 40ms surface / 80ms elevated overlay stagger, total settle ≤250ms), replacing flat 200ms wash
```

### Signature moments

```text
- Map marker tap → sheet rises peek → half (velocity-aware, bespoke Framer Motion sheet per DG75)
- Swipe cards: smooth scroll snap + subtle parallax on cover image;
  active card scales ~1.02, neighbors dim slightly — eye-catching but restrained
- Check-in confirm: button morphs to ✓ + micro coffee-steam animation + toast
  (detailed visual design handed to Kimi; must avoid confetti/AI-slop feel)
- Slider drag: live value + haptic-style scale on thumb; dimension bars animate with gentle spring on load
- Filter apply: results reflow with layout animation (Framer layoutId)
- Navigation prompt: slide-up card, auto-collapse to pill after 8s
- Deep-link banner: gentle rise, never blocks content
```

### Rules

```text
- Every animation has prefers-reduced-motion fallback
- prefers-reduced-motion degrades all springs and transitions immediately to 0ms static states
- Exits settle faster than enters (100–150ms exit budget vs 200–300ms enter budget)
- No animation longer than 450ms settle budget in normal flow
- Map interactions: immediate (no artificial delay)
- Loading: skeleton shimmer, not spinners — HeroUI Skeleton where the component
  fits; hand-rolled animate-pulse shells (discovery, search) are element-level
  CSS animation covered by the reduced-motion kill switch.
- Feed refresh/pagination: preserve the last successful content and put an inline
  error + Retry at the failed section; never replace real cards with placeholders
- Third-party exception (HeroUI toast, BRAWUKA-207): enter/exit slide is the
  library view-transition default, 350ms each — above both the enter
  (200–300ms) and exit (100–150ms) budgets. Accepted: the Toast provider
  exposes placement/maxVisibleToasts/timeout only, no duration hook; retuning
  would mean overriding library-internal ::view-transition keyframes.
  Revisit the 350ms exception if HeroUI exposes a duration hook.
  Reduced motion is covered by the app-side guard (BRAWUKA-208):
  `web/app/globals.css:360-365` sets `animation: none` on the
  `::view-transition-group|image-pair|old|new(*)` tree inside the existing
  `prefers-reduced-motion: reduce` block — the block's `*` element rules cannot
  match view-transition pseudo-elements, so the library's toast-slide keyframes
  and the UA group crossfade are zeroed only under reduce; normal flow keeps
  the 350ms default.
```

## Editorial Surfaces

### Check-in note prose card

```text
- Check-in note upgraded to first-class prose: --font-serif reading card + --font-mono
  metadata row (coordinates, timestamp, session telemetry)
- Within the ≤500-char cap, longer notes may use plain expandable progressive disclosure — no parallax, no marginalia ornament
- Empty check-in notes do NOT render any container or placeholder box (strictly zero visual padding/empty slot decoration)
- Check-in notes remain utility-first, authentic, and concise (≤500 chars) — never a blog, publishing platform, or sprawling essay; typographic refinement serves readability without imposing editorial bloat
```

### Editorial grid & layout rhythm

```text
- Asymmetric 12-column grid (optional 8/4 split) replacing centered single-column templates
- Outer margins: ≥ clamp(24px, 6vw, 96px)
- Breakpoint ≥lg (1024px) enables marginalia side columns for annotations, metadata, and footnotes
- Optimal prose measure: 62–68ch for narrative reading comfort
- Full-element centered symmetric templates are strictly prohibited on editorial surfaces
```

### Digital garden — not applicable as a product surface (Owner ruling, 2026-09-06)

```text
Manifesto principle 4 (digital garden) is NOT applicable as a product surface
(Owner ruling 2026-09-06, BRAWUKA-74). CafeMood is a pure tool: it has no
editorial/reading product surface, and none may be added. The principle's
aesthetic substance is carried by the design language alone — editorial
typography, asymmetric grid, and marginalia per §Typography / §Motion /
§Color & Material and the BRAWUKA-73 pilot — with no corresponding product
surface.

- The profile "手记" (notes) aggregation view is REJECTED; no new editorial
  surface is introduced.
- Gate (tightened): no agent may introduce any reading surface or top-level
  reading route without an explicit Owner ruling.
- Unaffected: the check-in note prose-card visual and typographic treatment
  (§Check-in note prose card) remains an accepted design-language application
  on an existing surface (BRAWUKA-69 Spec Diff; pilot via BRAWUKA-73).
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
               the map fills the remaining width — no right-side drawer;
               below xl (1280px) the detail column overlays the surface
               instead of squeezing it (#275)
  Activates at 1024px and uses the shared selection/URL state; never emulates
  mobile PEEK/HALF/FULL snaps
Deep-link/share landing: dedicated SSR /cafes/[id] in the separate seo-sharing slice

Breakpoints:
  sm: 640px   (large phone landscape)
  md: 768px   (tablet — mobile sheet remains active)
  lg: 1024px  (desktop — switch to sidebar + detail column)
  xl: 1280px  (wide desktop)

Viewport & safe area (DG75):
  Sheet/detent heights and any full-screen geometry use dynamic viewport
  units (dvh/svh), never raw vh — iOS/Android browser chrome collapsing
  and expanding must not cause layout jumps.
  All bottom-anchored surfaces (bottom sheet, check-in drawer, FAB,
  toasts, collapsed pill) pad by env(safe-area-inset-bottom); floating
  side chrome respects safe-area-inset-left/right in landscape. The root
  layout sets viewportFit=cover so the map paints edge-to-edge under the
  notch.
  BottomSheet implementation: bespoke Framer Motion (drag physics, detent
  snapping, and scroll handoff under our control), not a third-party sheet
  library. Owner-delegated decision, 2026-08-21.
```

## Dark mode

```text
Strategy: next-themes, class="dark" on <html>
Default: follow system preference (prefers-color-scheme)
Toggle: available in header (sun/moon icon)
Map: MapKit JS colorScheme toggles in sync with theme
Images: no dimming (photos should look true)
Transition: optical lighting transition across surface hierarchy (0ms base / 40ms surface / 80ms elevated overlay stagger, total settle ≤250ms), replacing flat 200ms cross-fade
```

## Copy tone (DG87)

```text
All product copy (en + zh) is 热情真诚 — warm, sincere, a little cute.
It reads like a friend who loves coffee, never like a company:
  - no commercial/sales phrasing, no growth-hacker pressure
  - no fake urgency, no guilt trips, no "don't miss out"
  - questions are asked the way a friend asks them
  - celebrations are small and genuine, not confetti-in-words
  - somber moments (404, errors, deletions) stay quiet and honest — cute
    never jokes at the user's expense
Concrete wording lives in each design artifact's i18n reference lines;
this principle governs them and any new copy.
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
- Dark theme brand pairs — WCAG 2.x contrast of the token pair, computed
  oklch -> linear sRGB -> relative luminance (Ottosson OKLab matrices; the sRGB
  transfer function is applied ONCE, so never re-linearise an already-linear
  channel). Ratios below are from the token values; the browser's own painted
  bytes agree within 8-bit quantisation.

    pair (dark)                                        before    after
    accent on accent-foreground                        6.27:1    6.27:1   pass
    danger on danger-foreground (filled button)         3.37:1    6.72:1   pass (BRAWUKA-219)
    white on danger-solid (filled button)               3.68:1    5.12:1   pass (BRAWUKA-211; before = white on the 64% plate)
    danger as text on surface-secondary                 3.17:1    5.92:1   pass (BRAWUKA-219, at a 55% plate)

  Zero regressions; the accent pair was already above the gate and is unchanged.

  Secondary text on dark surfaces uses `--muted`, not `--secondary`: sage is a
  fill/spot colour, and at 58% it reads 4.11:1 on surface-secondary. Danger's
  dark roles are split across two tokens — `--danger` is the text/border
  colour and `--danger-solid` the filled-button plate — because a single
  mid-luminance value cannot clear the gate in both (BRAWUKA-211).

  The gate is enforced in two places: `web/tests/design-tokens-contrast.test.ts`
  asserts these token pairs (and that hue/chroma are held) in `npm test`, and
  `npm run check:visual` scores the browser's painted bytes for every text
  sample across the route matrix in both themes, which is what catches
  page-level token misuse (BRAWUKA-219).
```

## Acceptance criteria

```text
- Swipe cards and bottom sheet feel premium and eye-catching without vibe-coding tells
- Work profile bars + score sliders are the visual hero of the cafe detail
- UI feels like a 2026 design studio portfolio piece
- No retro/vintage coffee aesthetic anywhere (coffee kitsch prohibited; editorial serif and warm paper substrate permitted per spec)
- HeroUI components are themed with CafeMood tokens (no default blue)
- Animation is spring-first, restrained, and elegant — spring tokens (soft/gentle/snappy) with settle budgets, not bounces or linear tweens
- Dual typography scales physically isolated: App ramp (xs-2xl) for chrome/forms, Editorial ramp (prose/lede/section/display) for narrative reading
- --font-serif (Source Serif 4 Variable + zh fallback) available for narrative prose (min 1rem), strictly excluded from tool/form surfaces
- Variable breathing (≤60 wght units) restricted to editorial display; prefers-reduced-motion degrades immediately to static weight
- Plate roles strictly enforced: dominant espresso ink (≥70%), secondary sage (≤30% per viewport, work-suitability only), single terracotta focal event per viewport
- Material token --grain (SVG feTurbulence) defined with strict opacity limits (0.03-0.05 light / 0.04-0.06 dark), pointer-events: none, never on map canvas, zero WCAG AA contrast regression
- Editorial surfaces adhere to 12-column asymmetric grid, marginalia at ≥lg, 62-68ch measure, and the check-in note prose card; no editorial/reading product surface is introduced (Owner ruling 2026-09-06, BRAWUKA-74)
- Dark mode is a true espresso theme with warm undertones and optical lighting transition
- Map (Apple Maps dark) feels integrated, not embedded
- Mobile layout is map-native with bottom sheet (snappy spring detent snap with drag momentum pass-through)
- Desktop layout has proper sidebar + map split
- Framer Motion layout animations on list reflow
- All interactive elements have hover/focus/active states
- prefers-reduced-motion disables all non-essential animation and instantly zeros springs
- No Material Design, generic SaaS, or AI-slop visual language
- No Shadcn components; HeroUI v3 is the sole library
- Kimi K3 design artifact exists for the slice and the implementation matches it
- Kimi K3 defines the Helpful/Newest control composition within the accepted behavior
- Kimi K3 defines the visual treatment for accepted Retry/toast/focus states and
  validates the mobile-sheet composition through tablet landscape
- `web/app/globals.css` implements accent, secondary, radius, and shadow tokens exactly
- HeroUI `<Toast.Provider>` is mounted in root providers
```
