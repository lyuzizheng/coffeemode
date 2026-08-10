---
name: coffeemode-implementation-cycle
description: Drive a CoffeeMode change from issue discovery through a verified, issue-linked PR. Use when building, fixing, or changing code, specs, docs, or harness, or when asked to take a feature or fix from idea to PR.
---

# CoffeeMode Closed-Loop Implementation Cycle

One issue → one fix plan → one slice → one branch → one PR → `Fixes #N`.

## Loop

1. **Orient** — run `.agents/scripts/preflight.sh`; read `AGENTS.md`, `docs/agent/reading-order.md`, and `docs/agent/current-state.md`.
2. **Intake** — find or create the issue:
   - If the user points to `#N`, verify it and load `coffeemode-issue-review-fix`.
   - If there is no issue, load `coffeemode-issue-submission` and file one with category, priority, and `file:line` evidence per `docs/agent/issue-guidelines.md`.
3. **Review & scope** — load `coffeemode-issue-review-fix` to triage, reclassify if needed, split solvable-now vs deferred per the Deferral policy, and post deferrals on the issue.
4. **Fix plan** — if the issue has no fix-plan comment, draft one using `.github/ISSUE_TEMPLATE/fix_plan.md` (omit the YAML frontmatter) as an issue comment. It must include:
   - Slice ID (register a new row in `docs/agent/implementation-slices.md` if needed)
   - Affected files/packages, schema/API/UI impact, test strategy, required doc updates
   - Risk tier: Fast / Standard / High
   Get user go-ahead before coding.
5. **Implement** — load `.agents/workflows/development-cycle.md`, select the slice, run `.agents/scripts/context-for-slice.sh <slice-id>`, obey its readiness gate, and make the change. Update `docs/agent/progress-log.md` and slice status as you go.
6. **Verify & review** — re-run preflight and package tests (`web`, `image-service`, `poi-service`). For Standard/High risk, generate `.agents/scripts/implementation-review-packet.sh` and load `coffeemode-code-review` with an independent reviewer. For docs/harness changes, generate `.agents/scripts/docs-review-packet.sh` and apply `.agents/docs-semantic-review.md`.
7. **Open PR** — branch `fix/issue-<n>-<slug>` or `feat/<slice>-<slug>`. Fill `.github/pull_request_template.md`, start the body with `Fixes #N`, and link the fix-plan comment. Push and open the PR only after user approval unless the user already asked for one.
8. **Close** — after merge, comment `Fixed in #N` on the issue and close it. Update `docs/agent/current-state.md` if phase/focus changed.

## Stop And Ask

Ask before: choosing a different fix direction than the issue suggests, irreversible migrations, product-meaning decisions, auth/secret handling, pushing a branch without approval, or skipping independent review for High-risk changes.
