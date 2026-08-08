# CoffeeMode Agent Entry Point

This file is the tool-neutral entry point for coding agents working in this repository.

1. Run `.agents/scripts/preflight.sh` — the master deterministic gate.
2. Follow `docs/agent/reading-order.md` for canonical reading order.
3. Route by intent via `.agents/ROUTER.md`.
4. After any docs/harness change, run the full gate again.
5. For docs changes, generate a review packet: `.agents/scripts/docs-review-packet.sh <base>`.
6. An independent reviewer applies `.agents/docs-semantic-review.md` to the packet.

## Harness scripts

| Script | Purpose |
| --- | --- |
| `.agents/scripts/preflight.sh` | Master gate: structural + all sub-checks |
| `.agents/scripts/check-docs-consistency.sh` | Doc alignment, whitespace, ADR status, authority separation |
| `.agents/scripts/check-ci-workflow.sh` | CI YAML validity, required gates, action versions |
| `.agents/scripts/check-implementation-slices.sh` | Slice manifest via the ruby validator |
| `.agents/scripts/check-links.sh` | Local markdown links resolve |
| `.agents/scripts/check-agent-skills.sh` | Skill frontmatter, naming, trigger phrase |
| `.agents/scripts/check-codex-agents.sh` | `.codex/` TOML shape and required values |
| `.agents/scripts/context-for-slice.sh` | Minimal canonical source index + readiness gate for one slice |
| `.agents/scripts/docs-review-packet.sh` | Generate self-contained packet for semantic review |
| `.agents/scripts/implementation-review-packet.sh` | Pinned base/head/fingerprint packet for code review |
| `.agents/scripts/harness-self-test.sh` | Fault-injection self-test of all gates |

## Rules

- Never bypass a failing gate. Fix the root cause.
- Specs are the source of truth for product decisions.
- `docs/agent/current-state.md` is the single source for phase/priority.
- The harness must not own product priorities or decisions.
- After a feature is implemented and tests pass, decide smartly whether to open a PR directly or pause for review:
  - If the user explicitly asked for a PR, or the change is a low-risk/docs-only fix with green gates, open the PR.
  - If the change is architectural, security-sensitive, changes public APIs, or is large, run an implementation review (subagent or packet) first and surface the findings to the user before opening the PR.
  - Before pushing a branch to create a PR, get explicit user approval unless the user already requested the PR.
