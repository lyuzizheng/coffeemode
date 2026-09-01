# 0000. Founder Manifesto Spec

## Goal

Codify the founder's product philosophy and engineering principles as the
canonical decision authority for CoffeeMode. Every feature proposal, design
choice, and cost tradeoff is judged against this manifesto before any other
spec. Specs 0001-0004 implement these principles; none may contradict them.

## Status

Accepted (2026-09-01 — initial codification of the founder's product
manifesto and design guidelines, Refs #288).

## Stable decisions

```text
- This manifesto is the highest-precedence spec: when another spec or a
  proposed change conflicts with a principle below, the manifesto wins
  unless the founder explicitly amends this document
- The three decision gates (Go/No-Go, How-to-build, Interaction) are
  applied in order to every user-visible change
```

### The core principles

```text
1. Value First & Real Problem Solving
   Build only what solves tangible problems for specialty coffee lovers and
   working nomads: finding a good cafe, knowing it is laptop-friendly,
   checking in fast. Zero vanity features. Every component exists to help
   the user discover good coffee and check in, quickly and elegantly.

2. Growth First & Low Friction Discovery
   Maximize organic growth by minimizing friction. First-run discovery
   works without an account; sign-in is deferred to the moment of publish
   (DG39). No forced onboarding walls, no growth-hacker pressure.

3. Zero Commercial Hostility
   No ads, no paywalls, no banner upsells, no forced reviews, no popups,
   no nagware, no dark patterns, no induced sharing. The product is quiet
   and pure: an immersive space that never interrupts the user to sell
   them something.

4. Minimal Cognitive Overhead & Speed
   The core discovery and check-in flow completes in under 3 seconds.
   No bloated settings, no redundant decoration, no tedious steps.
   Every screen earns its place; the fastest path is the default path.

5. Extreme Cost-Efficiency
   Zero commercialization means every penny of server cost matters.
   Prefer static snapshots, edge caching, client-side computation, and
   offline-capable lightweight interactions. Avoid needless network
   chatter and heavy server-side rendering where a cached artifact
   serves the same experience.

6. Exquisite Aesthetics / Zero Ugly Things
   High-taste humanistic aesthetics, always:
   - warm espresso foreground (--espresso) + elegant secondary sage
     (--secondary) brand palette
   - compact, dense radius (2px-8px); cards breathe through padding,
     not roundness
   - restrained typography hierarchy: text-2xl ceiling (hero/display,
     landing only)
   - skeleton loading, empty states, and error toasts are first-class
     designed surfaces — never raw text, never naked defaults
   - no crude borders, no harsh saturated colors, no rough placeholders,
     no cheap template feel
```

### The three decision gates

Every user-visible change passes three gates, in order:

```text
1. 做不做 (Go / No-Go)
   Does this solve a real, tangible user problem (principle 1)? Can it be
   done without commercial hostility (principle 3) and without new
   cognitive overhead (principle 4)? If any answer is no — do not build it.

2. 怎么做 (How to build)
   Given a Go, choose the implementation that best satisfies extreme
   cost-efficiency (principle 5): static snapshot before dynamic render,
   edge cache before origin, client compute before server round-trip.
   Cheap and fast is the default; expensive needs a written reason.

3. 怎么交互 (Interaction)
   Given the build, the interaction must be low-friction (principle 2),
   low-overhead (principle 4), and aesthetically impeccable (principle 6):
   skeleton/empty/error states designed, touch targets comfortable on
   mobile, no popup or nag ever ships.
```

A change that fails a gate stops there: No-Go rejects the feature;
How-to-build and Interaction failures send it back for redesign rather
than shipping a compromise.

## Edge cases

```text
- Tension between principles: Growth (2) never overrides Zero Commercial
  Hostility (3); Cost-Efficiency (5) never justifies an ugly or hostile UX
  (3, 6); Aesthetics (6) never justifies heavy client bundles that violate
  speed and cost (4, 5)
- Founder overrides: only the founder may amend or grant an exception to
  these principles; the amendment lands in this file, not in a comment
```

## Acceptance criteria

```text
- This file exists as the canonical founder manifesto, indexed in
  docs/specs/README.md
- `docs/specs/0002-design-system.md` references this manifesto as the
  source of its anti-ugly aesthetic invariants
- Agents and reviewers apply the three decision gates to every
  user-visible change
- `.agents/scripts/preflight.sh` passes with this spec in place
```
