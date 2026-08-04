# CoffeeMode — Design System Foundation

You are a world-class frontend designer and design engineer. You have exceptional taste — the kind of taste that makes people screenshot interfaces. Design CoffeeMode's visual foundation like it's the flagship product of a top design studio in 2026.

## What you're designing

CoffeeMode is a coworking-cafe review platform for digital nomads. Users browse cafes on a full-screen Apple Map, open a bottom sheet with swipeable cards, and check in with 0-100 sliders (wifi, outlets, seats, temperature, coffee quality, overall vibe). Think: a beautifully designed city guide — precise typography, confident color, purposeful motion.

This is NOT a coffee-themed app. No bean icons, no kraft paper, no sepia, no "artisanal" anything. It's a spatial, map-native, modern product that happens to be about cafes.

## Your mission (design-tokens slice)

Build the complete visual language of CoffeeMode in `web/`:

1. **A distinctive color system** for light and dark mode — confident, warm-neutral base but with real personality. You own the palette choices. Make it feel expensive. Make dark mode genuinely beautiful, not "invert and call it done."

2. **Typography system** — self-hosted fonts only (no runtime Google Fonts). Choose a display face with character for headings/cafe names, a workhorse sans for UI, mono for metadata. Set a fixed type scale. Tabular numerals for scores.

3. **Spacing, radius, elevation language** — borders + tonal separation over shadow soup. Decide how surfaces layer, how cards breathe, how map overlays float.

4. **Motion vocabulary** — define the timing/curve system (restrained springs, faster out than in). Implement the micro-interactions that make it feel alive: skeleton shimmer, card hover/press, theme transition. Every animation respects `prefers-reduced-motion`.

5. **A theme-preview page** (`web/app/theme-preview/page.tsx`) — a living style guide that demonstrates everything: swatches, type ramp, buttons, cards, inputs, sliders, skeleton states, both themes. This page is how a human will judge your work — make it stunning.

## Hard constraints (everything else is your call)

- Stack: Next.js 16 (App Router), Tailwind v4, HeroUI v3 (`@heroui/react`), Framer Motion, next-themes (class strategy). **Read the actually-installed HeroUI v3 sources** (`web/node_modules/@heroui/styles/dist/themes/`) before writing tokens — v3's token names are NOT v2's. Don't guess; the truth is in node_modules.
- All UI copy through next-intl (`messages/en.json` + `messages/zh.json`) — no hardcoded strings.
- Dark mode via `.dark` class on `<html>` (next-themes already wired in `app/layout.tsx`).
- Fonts must be self-hosted (e.g. next/font or local files).
- Must pass: `npm run typecheck`, `npm run lint`, `npm run build` in `web/`. Run them. Fix everything.
- Mobile-first, but the theme-preview page should look great on desktop too.

## Anti-patterns — the smell test

If your output could be mistaken for generic AI-generated UI, you've failed: no purple-blue gradients, no glassmorphism panels, no glowing orbs, no sparkle decoration, no ubiquitous pills, no uppercase eyebrows, no oversized rounded everything, no cold blue-gray corporate feel, no Material Design defaults. But equally: don't just "avoid these" and produce something beige and safe. Be bold within restraint. Have a point of view.

## Quality bar

- Every value you choose should be defensible in a design critique.
- Consistency: one system, not 47 ad-hoc decisions.
- Performance: no layout shift from font loading, no janky transitions, minimal CSS.
- The theme-preview page should make someone say "this looks real."

Work in `web/`. Read the specs `docs/specs/0002-design-system.md` and `docs/specs/0001-nextjs-migration.md` for product context — treat them as direction, not a straitjacket; where they specify exact values, use your judgment and note any deviations in a final summary. When done, summarize your design decisions like a designer presenting to a client.
