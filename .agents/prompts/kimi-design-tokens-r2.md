# Design review — round 2

I reviewed `/theme-preview` in a real browser (both themes, desktop). The foundation is strong — the token architecture, type system, and single-brand-voice decision are exactly right. Four confirmed issues to fix. How you fix them is your call; keep your taste in charge.

## Confirmed issues (verified against code + rendered output)

1. **Swatch captions show truncated raw values.** Every swatch displays ellipsized `lab(23.6527% …` / `color-mix(in oklab, …` strings. Unreadable, uncopyable, and it reads as a debug artifact. A real design system shows clean, short values. Fix this — you know what a good swatch caption looks like.

2. **Dark-mode contrast.** Muted body copy, eyebrows, and swatch captions on the espresso background are dim — several likely fail WCAG AA. Check `--muted` and caption-level text in dark mode specifically. Light mode needs the same pass.

3. **`--default` appears under both "Base & surfaces" and "Brand & neutrals"** in the Color section. Deduplicate — one honest home per token.

4. **The hero is bloodless.** "Design system foundation / Design System" is redundant and leaves the right half empty. This page is CoffeeMode's design voice — give it a moment worth remembering. You have the palette and the type; make the opening earn them.

## Verified as NOT issues (do not "fix" these)

- The size ramp (sm/md/lg buttons) renders correctly — 32/36/40px on desktop; that's HeroUI v3's actual ramp, subtle by design. Leave it.
- Sliders, cards, motion sections exist below the fold — earlier review missed them due to viewport capture.

Run typecheck/lint/build after. When done, summarize what you changed and why, like a designer walking through a revision.
