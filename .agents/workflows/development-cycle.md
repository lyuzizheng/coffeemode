# Development Cycle

Use this workflow for any non-trivial coding or documentation task.

## Loop

1. Run `.agents/scripts/preflight.sh` — must pass before starting.
2. Route the prompt with `.agents/ROUTER.md`.
3. For app work, read the relevant spec from `docs/specs/`.
4. Read `docs/agent/current-state.md` and `docs/agent/implementation-slices.md`.
5. Implement the change.
6. Run `.agents/scripts/preflight.sh` again — must pass after changes.
7. If docs/harness files changed:
   a. Generate packet: `.agents/scripts/docs-review-packet.sh <base>`
   b. An independent reviewer applies `.agents/docs-semantic-review.md`.
   c. Do not merge until verdict is `pass` or `needs_design` is resolved by the user.
8. Update `docs/agent/progress-log.md` with what changed.
9. Update `docs/agent/current-state.md` if phase/priority shifted.

## Execution tiers

| Tier | When | Gates |
| --- | --- | --- |
| Fast | Typo, formatting, comment-only | preflight |
| Standard | Feature, bugfix, refactor | preflight + CI (typecheck, lint, test, build) |
| High | Architecture, spec change, harness change | preflight + CI + semantic review |

## Consequence escalation

- Tier 1 (Fast): agent self-verifies with preflight.
- Tier 2 (Standard): CI must be green before merge.
- Tier 3 (High): independent semantic review required; agent cannot self-approve.
