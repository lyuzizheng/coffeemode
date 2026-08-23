# CoffeeMode Agent Entry Point

This file contains repository-wide invariants only. Detailed agent procedure lives
under `.agents/`.

## Start

1. Run `.agents/scripts/preflight.sh`.
2. Follow the reading order in `.agents/README.md`.
3. Route the task through `.agents/ROUTER.md`.
4. For issue-driven implementation, follow `.agents/workflows/closed-loop.md`.

## Source ownership

- Product, API, data, UI, and testing truth: `docs/specs/`.
- Accepted architecture rationale: status-bearing `docs/adr/` records.
- Current phase, blockers, and implementation plan: `docs/agent/`.
- Agent rules, workflows, skills, and deterministic gates: `.agents/`.
- Codex role/model/sandbox bindings: `.codex/`; these must point back to
  `.agents/` and must not restate the workflow.

Resolve conflicts through `docs/STRUCTURE.md`. The harness must never own product
priorities or decisions.

## Rules

- Make the smallest complete change and preserve unrelated work.
- Build shared behavior as segregated, reusable service components with clear
  module boundaries (e.g. the prompt queue, the rate limiter): feature code
  composes them, never embeds or duplicates them. No duplicated logic, no
  cross-feature coupling — the repo is expected to grow large (DG91).
- Product parameters (thresholds, TTLs, caps, limits) live in typed config
  files under `web/config/`, read through helpers — never hardcoded or
  scattered through feature code (DG107).
- Never bypass a failing gate; fix the root cause.
- One production-code writer per change. Reviewers do not author the patch.
- Run the narrowest test that proves the change, then the relevant package gate.
- Database migrations, embedded SQL, and DB-backed flows require the real-Postgres
  gate defined in `docs/specs/0003-testing-and-ci.md`.
- Any change to `docs/`, `.agents/`, `.codex/`, this file, or the CI/harness
  authority requires `.agents/scripts/docs-review-packet.sh <base>` and an
  independent verdict using `.agents/docs-semantic-review.md`.
- Always create a PR after completing a development cycle and follow the
  closed-loop workflow (`.agents/workflows/closed-loop.md`) until the PR is
  ready to merge. Do not merge without explicit authority.
- If no GitHub PR template exists, the PR body must include `## Context`.
