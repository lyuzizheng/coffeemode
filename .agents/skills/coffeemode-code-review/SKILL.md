---
name: coffeemode-code-review
description: Review CoffeeMode changes for correctness, safety, spec consistency, overengineering, and test validity. Use when the user asks for review, audit, PR feedback, risk analysis, or a cleanup pass after implementation.
---

# CoffeeMode Code Review

## Workflow

Run `.agents/workflows/review-code.md` against the complete stable diff, task-relevant specs, and status-bearing ADRs. Generate the handoff with `.agents/scripts/implementation-review-packet.sh <slice-id> [base]` and share the slice context with the reviewer. Require the focused evidence selected by `.agents/workflows/development-cycle.md` before review, and repeat the full cumulative-diff review after fixes. Apply `.agents/docs-semantic-review.md` separately whenever its change-scope trigger matches.
