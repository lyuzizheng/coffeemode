---
name: coffeemode-code-review
description: Review CoffeeMode changes for correctness, safety, spec consistency, overengineering, and test validity. Use when the user asks for review, audit, PR feedback, risk analysis, or a cleanup pass after implementation.
---

# CoffeeMode Code Review

Run `.agents/workflows/review-code.md` against the complete stable diff and
task-relevant sources. Generate the handoff with
`.agents/scripts/implementation-review-packet.sh <issue-N|slice-id> [base]`.
Repeat cumulative review after fixes and apply `.agents/docs-semantic-review.md`
separately whenever its scope trigger matches.

Structure is a mandatory gate: apply the Structure gate in
`.agents/workflows/review-code.md` (`docs/specs/0009` §§3–6). A structure
failure means rework even when behavior is correct — never waive it for
functional correctness.
