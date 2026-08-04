---
name: coffeemode-ui-quality
description: Refine CoffeeMode UI toward the agreed 2026 design system and verify visual quality. Use when working on UI, the map home, bottom sheet, cards, design tokens, interaction, layout, or visual polish.
---

# CoffeeMode UI Quality

## Workflow

Run `.agents/workflows/refine-ui.md` against `docs/specs/0002-design-system.md` and the UI sections of `docs/specs/0001-nextjs-migration.md`. The workflow owns the procedure; the specs own visual behavior.

Non-negotiables: restrained, elegant animation (Framer Motion), dark mode parity, compact mobile-first layouts, and zero vibe-coding template feel. Verify user-visible changes in a real browser, not only with unit tests.
