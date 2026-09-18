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
   - Density invariants hold (spec 0002 §Spacing and radius): concentric
     radius on nested rounded corners, chip sizing matches interactivity,
     every tappable ≥44px effective height, skeletons mirror real layout
     geometry, no layout magic numbers outside `web/lib/layout.ts`
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
Bordered elements without an explicit rounded-* class
Nested rounded corners that ignore the concentric radius rule
Tappable targets under 44px effective height
Skeletons whose geometry does not match the real layout
```
