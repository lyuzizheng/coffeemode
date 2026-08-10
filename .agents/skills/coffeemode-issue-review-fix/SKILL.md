---
name: coffeemode-issue-review-fix
description: Pick up, triage, scope, and fix CoffeeMode GitHub issues as PRs. Use when the user asks to fix a GitHub issue, review open issues for solvability, plan a fix, or close out issue-driven work.
---

# CoffeeMode Issue Review & Fix

## Loop

1. Orient: `.agents/scripts/preflight.sh` must pass; read
   `docs/agent/issue-guidelines.md`, `docs/agent/reading-order.md`, and
   `docs/agent/current-state.md`.
2. **Verify before you trust** (guidelines §Critical fix): the issue text
   is a hypothesis, not a contract. Reproduce the defect against current
   code and confirm the cited file:line. When a claim is wrong (wrong
   site, already-compliant code, shifted line), do NOT "fix" it blindly —
   comment on the issue with the evidence and carry the correction into
   the PR. Evidence over authority.
3. Triage each candidate issue:
   - Re-classify category/priority if needed; comment on the issue when
     the classification changes.
   - If the issue duplicates an open issue (same component + same defect
     class), merge into the original per the Dedup gate — never fix a
     duplicate in parallel.
4. Scope: split the issue into solvable-now vs deferred parts. Apply the
   Deferral policy from the guidelines — comment deferrals on the issue
   with rationale and a follow-up reference; never half-implement.
5. Plan: present the fix plan to the user and get a go-ahead before
   implementing (the user may want a different scope or order).
6. Implement via `.agents/workflows/development-cycle.md`:
   - Register the fix as a slice in `docs/agent/implementation-slices.md`
     (insert a new row inside the `## Slice manifest` table, before the
     `## Status vocabulary` section and the `Rules` block).
   - Load its context with `.agents/scripts/context-for-slice.sh <id>` and
     verify the readiness gate before writing code.
   - **Root cause + sibling sweep (举一反三):** fix the shared root cause,
     then grep every consumer of the touched component/pattern and fix
     every call site with the same defect in the same PR. The PR states
     the full site list, including sites the issue never named.
   - One issue → one branch → one PR; branch `fix/issue-<n>-<slug>`.
   - PR body starts with `Fixes #N`; if stacked on an unmerged branch,
     state the merge order.
7. Verify: preflight green, package tests green (`web`, `poi-service`,
   `image-service`), typecheck clean. Update `docs/agent/progress-log.md`.
8. **Escalate what you find:** a new, separable problem discovered during
   the fix becomes a follow-up issue through the submission skill's Dedup
   gate, or a comment on the current issue when it is the same defect
   class. Link both directions (`Found while fixing #N` / `Follow-up:
   #M`) and mention the follow-up in the PR.
9. Close the loop: after the PR merges, comment `Fixed in #N` on the
   issue and close it. Deferred parts stay open with the deferral comment.

## Scope rules

- The smallest change that makes the issue's acceptance criteria true.
- Do not fold unrelated refactors into an issue fix — but a sibling sweep
  that fixes the SAME defect at other call sites of a shared component is
  part of the fix, not an unrelated refactor.
- If the issue's suggested direction is infeasible (e.g. native `sharp`
  on Workers), say so on the issue and implement the feasible part.

## Stop And Ask

Ask before: choosing a different fix direction than the issue suggests,
irreversible migrations, product-meaning decisions, or pushing branches
without the user's go-ahead.
