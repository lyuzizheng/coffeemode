# CoffeeMode Canonical Specs

`docs/specs/` is the canonical implementation source of truth for CoffeeMode.

## Reading rule

Read only the specs relevant to the task plus `docs/agent/current-state.md`.

Do not load every spec by default unless the task spans the whole system.

## Spec map

| Spec | Canonical topic |
| --- | --- |
| `0001-nextjs-migration.md` | Full migration from Vite SPA to Next.js App Router |
| `0002-design-system.md` | Visual direction, tokens, typography, motion — 2026 standard |
| `0003-testing-and-ci.md` | Testing strategy, fixture policy, CI gates, automation |
| `0004-product-decisions-and-backlog.md` | Subagent review output, proposed decisions, and implementation backlog |

## Adding a new spec

Add a new spec only when no existing spec can own the decision.

Required format:

```text
# 00XX. Title

## Goal
## Stable decisions
## Data/API/UI behavior when relevant
## Edge cases
## Tests / acceptance criteria
```

## Updating specs

When changing a decision:

```text
1. Update the canonical spec.
2. Update docs/agent/current-state.md if implementation direction changes.
3. Update docs/agent/progress-log.md.
```
