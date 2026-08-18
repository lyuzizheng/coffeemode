# CoffeeMode Agent Harness

This folder contains procedure only. Intended product and implementation behavior belongs in `docs/specs/`; architecture decisions belong in status-bearing ADRs under `docs/adr/`.

## Start

1. Run `.agents/scripts/preflight.sh`.
2. Follow `docs/agent/reading-order.md`.
3. Select the task-relevant skill and workflow from `.agents/ROUTER.md`.
4. For app work, select a slice from `docs/agent/implementation-slices.md`.
5. Generate the shared minimal context with `.agents/scripts/context-for-slice.sh <slice-id>`.
6. Obey the packet readiness: `STOP` blocks coding; `READY` permits implementation; `COMPLETE` means verify, do not re-implement.

## Shape

```text
.agents/
  README.md
  ROUTER.md
  docs-semantic-review.md
  workflows/   detailed task loops
  skills/      trigger-oriented entry points
  scripts/     deterministic gates, slice context, and review packets
```

Narrative role files, repeated product rules, static priority lists, and generic templates are intentionally excluded. They create additional sources of truth without adding executable guarantees.

Project-scoped executable agent bindings live separately in `.codex/agents/`. Those small TOML files pin role instructions, model, reasoning effort, and only intentional subagent permission defaults. Implementer has no repo-local sandbox default; explorer/reviewer default to read-only and tester defaults to workspace-write. Main-agent permissions stay user/session-owned rather than being copied into the repo.

## Two-layer gate

Layer 1 (deterministic, CI-enforced):

| Script | Purpose |
| --- | --- |
| `scripts/preflight.sh` | Master gate: structural checks + all sub-checks |
| `scripts/check-docs-consistency.sh` | Doc alignment, whitespace, ADR status, authority separation |
| `scripts/check-ci-workflow.sh` | CI YAML validity, required gates, action versions |
| `scripts/check-implementation-slices.sh` | Slice manifest via the ruby validator |
| `scripts/check-links.sh` | Local markdown links resolve |
| `scripts/check-agent-skills.sh` | Skill frontmatter, naming, trigger phrase |
| `scripts/check-codex-agents.sh` | `.codex/` TOML shape and required values |
| `scripts/harness-self-test.sh` | Fault-injection self-test of the gates |

Slices declaring the `integration` test gate additionally require the package-level
real-Postgres suite (`cd web && npm run test:integration`, RUN_INTEGRATION=1) green
on the final diff — deterministic harness checks cannot validate SQL semantics, so
migrations/triggers/DB flows must be proven on a real Postgres/PostGIS
(`docker compose up -d --wait postgres`; see `docs/agent/local-dev-stack.md`).

Layer 2 (semantic, human/independent-agent): `.agents/docs-semantic-review.md` applied to `.agents/scripts/docs-review-packet.sh <base>` whenever docs, harness, or agent configuration files change. Deterministic CI does not attest semantic review.

Supporting tools:

| Script | Purpose |
| --- | --- |
| `scripts/context-for-slice.sh` | Minimal canonical source index + readiness gate for one slice |
| `scripts/implementation-slices.rb` | Single slice parser: `check`, `list`, `context <id>` |
| `scripts/docs-review-packet.sh` | Self-contained packet for semantic docs review |
| `scripts/implementation-review-packet.sh` | Pinned base/head/fingerprint packet for code review |
