# Theme Variants — Retro Editorial & Modern Industrial (v1)

Status: Approved — owner directive 2026-09-19 (verbatim in BRAWUKA-505)
Slice: design-variants (mechanism shipped in BRAWUKA-370; personalities in BRAWUKA-505)
Spec: `docs/specs/0002-design-system.md` §Design variants

## Owner directive (verbatim)

> Theme 要两个，一个 retro 一点的，找一个精致的带衬线的中文+英文字体，没有 button 圆角，啥都没有，然后微阴影，非常立体感和复古。第二个要做现代一点，圆润和谐，比较工业风一点的 比较 geek 一点的 咖啡店收藏界面。

## Axis model

`data-variant` on `<html>` is a second theme axis orthogonal to next-themes'
light/dark. Three values: `default` (absent — spec 0002 as shipped),
`retro`, `modern`. The espresso + sage brand plate, status tokens, and the
type scale are shared; each variant owns shape, voice, texture, elevation,
and motion personality. Selection persists in localStorage and applies
pre-paint via the existing inline bootstrap — zero flash, zero layout shift.

## Retro — 复古编辑风 (editorial print)

A paper-bound city guide. The personality is *subtraction*: everything a
rounded SaaS UI does with gloss, retro does with hairlines, serif type, and
paper lift.

- **Shape**: every radius token is 0 — buttons, fields, chips, cards,
  sheets, pills, avatars, the switch, the FAB. HeroUI is fully token-driven,
  so the whole library squares with the scale; `rounded-full` is re-routed
  through `--radius-full` so pills square without touching call sites.
- **Type**: the entire UI speaks serif — `--font-sans`, `--font-display`,
  and `--font-serif` all resolve to Source Serif 4 → Noto Serif SC
  (self-hosted GB2312 level-1 subset, ~1.4MB, fetched only by retro users
  rendering CJK) → Songti SC. The wordmark, buttons, fields, and prose are
  one voice. `.tnum` numerals go oldstyle; `font-mono` stays JetBrains as
  the deliberate typewriter accent on metadata.
- **Elevation**: paper-lift shadows — low spread, low alpha, warm espresso
  offset. Filled buttons carry `shadow-sm`; ghost/outline stay flat.
  Hairlines (`--border`/`--separator`) drop one contrast step — print rules,
  not chrome.
- **Texture**: monochrome feTurbulence grain on the body canvas, baked into
  a data-URI (4% light / 5% dark — inside the `--grain` budget). No image
  request, no extra element, never on the map canvas.
- **Glass**: forbidden. `backdrop-filter` is killed variant-wide and the
  translucent overlay chrome re-opacifies to `--background`/`--overlay`.
- **Dark**: same warm espresso plate; lift shadows stay out (dark separates
  with hairlines), hairlines soften a step further, grain lifts to 5%.
- **Motion**: printing-press springs — stiffer attack, heavier damping,
  shorter travel, zero bounce (gentle 300/36, snappy 500/40, soft 220/32).

## Modern — 现代工业 geek 风 (industrial instrument)

A precision collection dashboard. Rounded, but *systematically* rounded —
the geek voice comes from mono data annotations and blueprint hairlines,
not candy gloss.

- **Shape**: concentric radius scale — `inner = outer − gap`, so a 2px gap
  steps each level down exactly: xs 6 / sm 10 / md 12 / lg 16 / xl 20 /
  2xl 16 / 3xl 20 / 4xl 24 / full pill. Segmented track `md` 12 + `p-0.5`
  → segment `sm` 10; card `md` 12 + 2px gap → chip `sm` 10; sheet `lg` 16
  + 4px padding → inner card `md` 12.
- **Type**: UI stays Inter/Cabinet. The data rule: every `.tnum`
  annotation — scores, distances, counts, timestamps — resolves to
  JetBrains Mono. Mono is the annotation voice, never body copy.
- **Neutrals**: cooler plate. Light shifts to hue 250 (background 97.8%,
  foreground 22%); dark becomes cold graphite (hue 250–260, background
  16%, foreground 92%). Accent, sage, and status stay shared — brand
  contrast math is unchanged.
- **Texture**: blueprint grid on the body canvas — 44px hairline grid at
  5% (light) / 7% (dark) foreground mix, pure CSS gradients, no request.
- **Motion**: instrument springs — slightly softer damping lets motion
  breathe a hair more (gentle 260/26, snappy 400/28, soft 180/22).

## Picker & preview

`ThemeVariantPicker` renders each option as a mini preview that uses the
real variant tokens: the swatch sets `data-variant` on itself, so radius,
font, and shadow custom properties resolve inside the subtree exactly as
they would app-wide. `[data-variant="default"]` pins the default
personality so the preview stays honest under another active variant; all
swatches show the light plate. Entry points: /profile Preferences
(authenticated) and the anonymous gate footer — both localStorage-backed,
no server round-trip.

`/theme-preview` mounts the same picker in its header — the acceptance
surface: every section walkthrough runs per variant × light/dark.

## Verification

- `tests/design-tokens-contrast.test.ts` merges each variant block onto
  its theme plate and asserts every text pair ≥4.5:1 in all four
  quadrants (64 assertions).
- `scripts/visual-smoke.mjs` renders `/theme-preview` under all three
  variants × both schemes × both viewports (12 renderings) with the
  painted-byte AA audit.
- zh-locale retro verified: `notoSerifSC` loads and paints 设计系统/body
  copy in real serif CJK.
