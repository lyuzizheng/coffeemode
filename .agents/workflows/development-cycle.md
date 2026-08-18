# Development Cycle

Use this workflow for any non-trivial coding or documentation task.

## Loop

1. Run `.agents/scripts/preflight.sh` — must pass before starting.
2. Route the prompt with `.agents/ROUTER.md`.
3. For app work, select a slice from `docs/agent/implementation-slices.md` and generate `.agents/scripts/context-for-slice.sh <slice-id>`. Obey the readiness gate: `STOP` blocks coding; `READY` permits implementation; `COMPLETE` means verify, not re-implement.
4. Read `docs/agent/current-state.md` and the specs listed in the slice context.
5. Implement the change (one production-code writer per slice).
6. Run `.agents/scripts/preflight.sh` again — must pass after changes.
7. If docs/harness files changed:
   a. Generate packet: `.agents/scripts/docs-review-packet.sh <base>`
   b. An independent reviewer applies `.agents/docs-semantic-review.md`.
   c. Do not merge until verdict is `pass` or `needs_design` is resolved by the user.
8. Update `docs/agent/progress-log.md` with what changed.
9. Update `docs/agent/current-state.md` if phase/priority shifted.

## Execution tiers

This table is the single canonical definition of the risk tiers. Every other
document (iteration protocol, fix-plan and PR templates) refers to it rather
than restating the criteria.

| Tier | When | Gates | Approval |
| --- | --- | --- | --- |
| Fast | Typo, formatting, comment-only | preflight (agent self-verifies) | Agent |
| Standard | Feature, bugfix, refactor | preflight + CI (typecheck, lint, test, build) green before merge | Agent, one independent role for material evidence |
| High | Architecture, spec change, migration, auth/security/secrets, deployment, harness authority | preflight + CI + independent review on the final stable diff | Independent reviewer; agent cannot self-approve |

When the slice declares the `integration` gate — any change touching
`web/db/migrations/`, embedded SQL, or DB-backed flows — the gates for its tier
ALSO include `npm run test:integration` green on the final diff (real
Postgres/PostGIS via `docker compose up -d`; see `docs/agent/local-dev-stack.md`).
Reasoning-only SQL validation never satisfies a declared `integration` gate.
User-visible flows additionally require e2e coverage once Playwright lands
(post-MVP); until then the rendered-page smoke gate is the browser-level floor.

Risk follows consequences, not line count. Independent of tier, any change
touching `docs/`, `.agents/`, root `AGENTS.md`, or the docs-harness CI workflow
also triggers the semantic-review gate (see the "Bias to action" exception in
`AGENTS.md`); tiers relax how much verification a change needs, never whether
that gate applies.
