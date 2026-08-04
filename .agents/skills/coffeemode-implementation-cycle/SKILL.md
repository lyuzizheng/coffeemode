---
name: coffeemode-implementation-cycle
description: Implement CoffeeMode feature slices with docs, tests, build, and progress updates aligned. Use when building, fixing, or changing CoffeeMode code or implementation specs.
---

# CoffeeMode Implementation Cycle

## Loop

1. Orient with `.agents/scripts/preflight.sh`.
2. Select a slice and generate `.agents/scripts/context-for-slice.sh <slice-id>`; obey its readiness gate.
3. Run `.agents/workflows/development-cycle.md` and the task-specific workflow from `.agents/ROUTER.md`.
4. Apply the change-scope trigger in `.agents/docs-semantic-review.md` with a reviewer that did not author the patch. If unavailable, report the gate as blocked.

## Stop And Ask

Ask before deciding product meaning (scores, policies, check-in semantics), auth/secret handling, irreversible migrations, deployment targets, or visual identity.
