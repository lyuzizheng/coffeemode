---
name: coffeemode-issue-review-fix
description: Pick up, triage, scope, and fix CoffeeMode GitHub issues as PRs. Use when the user asks to fix a GitHub issue, review open issues for solvability, plan a fix, or close out issue-driven work.
---

# CoffeeMode Issue Review & Fix

## Loop

1. Orient: `.agents/scripts/preflight.sh` must pass; read
   `docs/agent/issue-guidelines.md`, `docs/agent/reading-order.md`, and
   `docs/agent/current-state.md`.
2. Triage each candidate issue:
   - Verify the evidence against current code (the code may have moved on).
   - Re-classify category/priority if needed; comment on the issue when
     the classification changes.
3. Scope: split the issue into solvable-now vs deferred parts. Apply the
   Deferral policy from the guidelines — comment deferrals on the issue
   with rationale and a follow-up reference; never half-implement.
4. Plan: present the fix plan to the user and get a go-ahead before
   implementing (the user may want a different scope or order).
5. Implement via `.agents/workflows/development-cycle.md`:
   - Register the fix as a slice in `docs/agent/implementation-slices.md`
     (insert a new row inside the `## Slice manifest` table, before the
     `## Status vocabulary` section and the `Rules` block).
   - Load its context with `.agents/scripts/context-for-slice.sh <id>` and
     verify the readiness gate before writing code.
   - One issue → one branch → one PR; branch `fix/issue-<n>-<slug>`.
   - PR body starts with `Fixes #N`; if stacked on an unmerged branch,
     state the merge order.
6. Verify: preflight green, package tests green (`web`, `poi-service`,
   `image-service`), typecheck clean. Update `docs/agent/progress-log.md`.
7. Close the loop: after the PR merges, comment `Fixed in #N` on the
   issue and close it. Deferred parts stay open with the deferral comment.

## Scope rules

- The smallest change that makes the issue's acceptance criteria true.
- Do not fold unrelated refactors into an issue fix.
- If the issue's suggested direction is infeasible (e.g. native `sharp`
   on Workers), say so on the issue and implement the feasible part.

## Stop And Ask

Ask before: choosing a different fix direction than the issue suggests,
irreversible migrations, product-meaning decisions, or pushing branches
without the user's go-ahead.
