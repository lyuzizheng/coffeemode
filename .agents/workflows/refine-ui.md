# Refine UI

Use this workflow for UI design and visual quality tasks.

## Loop

1. Run `.agents/scripts/preflight.sh`.
2. Read `docs/specs/0002-design-system.md` for the canonical visual direction.
3. Identify the surface being changed and its design requirements.
4. Implement changes following the spec's palette, typography, motion, and layout rules.
5. Verify:
   - Contrast ratios meet accessibility thresholds
   - No default Shadcn/Material/generic-AI visual language remains
   - Motion follows the accepted rhythm with reduced-motion fallback
   - Empty/loading/error states are designed
   - Visual inspection confirms the result
6. Update the design system spec if a new token or pattern is introduced.

## Anti-patterns to reject

```text
Default Shadcn blue/gray palette
Generic card grids without spatial context
Purple-blue gradients or glass panels
Material Design elevation stacks
Uppercase eyebrow labels as default hierarchy
Bounce/elastic easing on functional UI
```
