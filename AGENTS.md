# CoffeeMode Agent Entry Point

This file is the tool-neutral entry point for coding agents working in this repository.

1. Run `.agents/scripts/preflight.sh` — the master deterministic gate.
2. Follow `docs/agent/reading-order.md` for canonical reading order.
3. Route by intent via `.agents/ROUTER.md`.
4. After any docs/harness change, run the full gate again.
5. For docs changes, generate a review packet: `.agents/scripts/docs-review-packet.sh <base>`.
6. An independent reviewer applies `.agents/docs-semantic-review.md` to the packet.

## Harness scripts

The canonical list of harness scripts and what each asserts lives in
`.agents/README.md` (the two-layer gate). `.agents/scripts/preflight.sh` is the
master gate that runs the deterministic sub-checks; `.agents/scripts/harness-self-test.sh`
fault-injects them.

## Issue workflow

- GitHub issues are the intake for fixes. File and triage them per
  `docs/agent/issue-guidelines.md` (categories, priorities, template).
- Filing/reporting: load the `coffeemode-issue-submission` skill.
- Reviewing/scoping/fixing issues: load the `coffeemode-issue-review-fix`
  skill — one issue → one branch → one PR with `Fixes #N`.
- When an issue's suggested direction is infeasible or lacks a product
  driver, comment the deferral on the issue (see Deferral policy in the
  guidelines); never half-implement.

## Rules

- **Bias to action.** On clear, in-scope work, proceed and verify — do not stop
  to ask for confirmation on trivial, reversible, no-behavior changes (the Fast
  tier in `.agents/workflows/development-cycle.md`). Fast changes are not taxed
  with heavyweight process. Stop and ask only for the scoped ask-list in
  `docs/agent/iteration-protocol.md` §7, or when the specs genuinely do not
  answer a product decision. The gates below are guardrails, not brakes on
  starting clearly-authorized work.
  - **Exception (independent review is never skipped):** any change touching
    `docs/`, `.agents/`, root `AGENTS.md`, or the docs-harness CI workflow
    triggers the independent semantic-review gate (`.agents/docs-semantic-review.md`)
    regardless of tier — the author cannot self-approve it. Tiers relax *how much*
    verification a change needs, never whether this gate applies.
- Never bypass a failing gate. Fix the root cause.
- Specs are the source of truth for product decisions.
- `docs/agent/current-state.md` is the single source for phase/priority.
- The harness must not own product priorities or decisions.
- After a feature is implemented and tests pass, decide smartly whether to open a PR directly or pause for review:
  - If the user explicitly asked for a PR, or the change is a low-risk app-code fix with green gates, open the PR.
  - Docs/harness changes additionally require a `pass` from the independent semantic-review gate (green CI alone does not attest it — see `.agents/README.md` Layer 2) before opening the PR.
  - If the change is architectural, security-sensitive, changes public APIs, or is large, run an implementation review (subagent or packet) first and surface the findings to the user before opening the PR.
  - Before pushing a branch to create a PR, get explicit user approval unless the user already requested the PR.
