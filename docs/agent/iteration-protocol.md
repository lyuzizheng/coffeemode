# Iteration Protocol

Follow this protocol for every future AI coding session in this repository.

## 1. Orient

Run `.agents/scripts/preflight.sh`, follow `docs/agent/reading-order.md`, then read task-relevant canonical specs and ADRs.

## 2. Classify the task

Classify the task as one or more of:

```text
product-docs
architecture-docs
schema/data-model
frontend-ui
api/server-action
poi-service (Cloudflare Workers)
image-pipeline
tests/fixtures
build/deploy
```

## 3. Plan from specs

For implementation work, select a slice from `docs/agent/implementation-slices.md` and generate `.agents/scripts/context-for-slice.sh <slice-id>`. If no slice/spec owns the behavior, update the focused spec before coding.

Obey the generated readiness result. `STOP` blocks coding. `READY` permits implementation. `COMPLETE` means verify rather than re-implement.

A coding plan should include:

```text
files/packages touched
schema/migration impact
API/service impact (Next.js route handlers, POI service)
UI impact
test strategy (Vitest + RTL + tsc --noEmit; REAL-DB integration via
  npm run test:integration for SQL/migration/DB-backed flows; Playwright E2E post-MVP)
required doc updates
```

## 4. Implement in small slices

Size execution by consequence using the Execution tiers table in `.agents/workflows/development-cycle.md` (the single canonical definition of Fast / Standard / High). Never run multiple source-writing agents concurrently.

Prefer slices that produce a verifiable result:

```text
schema migration + real-DB integration test (npm run test:integration)
API route + unit test (+ integration test when it touches SQL/DB flows)
MapKit component + Playwright flow
POI Worker + unit test against wrangler dev
upload pipeline + fixture images
```

## 5. Validate like an autonomous coding agent

Each slice should have a clear validation artifact:

```text
typecheck (tsc --noEmit)
Vitest unit/component tests
REAL-DB integration (npm run test:integration) — REQUIRED for changes touching
  web/db/migrations/*.sql, embedded SQL, or DB-backed lib flows
Playwright e2e flow (post-MVP)
production build (next build)
wrangler dev smoke for the POI service
UI screenshot/browser check for visible changes
```

Every implementation, testing, and review role used for a task must share the same slice ID and generated context packet.

For UI work, run the app and inspect it in a browser; user-visible flows must not stop at a mocked component.

## 6. Keep docs/code aligned

At the end of a meaningful change:

- update `docs/agent/progress-log.md`;
- update `docs/agent/current-state.md` when focus or phase changes;
- update `docs/specs/` when implementation contracts change;
- update or add ADRs when a major architecture decision is accepted or replaced;
- update `docs/agent/implementation-slices.md` slice statuses;
- run `.agents/scripts/preflight.sh`;
- run independent semantic review (`.agents/docs-semantic-review.md`) when docs, harness, or project agent configuration files changed.

## 7. Act by default; ask only on the scoped list

Default to acting on clear, in-scope, authorized work and verifying with the tier's gates — see the "Bias to action" rule in `AGENTS.md`. Trivial, reversible, no-behavior changes are Fast tier and need no confirmation.

Stop and ask the user (do not guess) only when a decision falls in one of these scoped areas and the specs do not answer it:

```text
- money / pricing display or data-correctness semantics
- irreversible data shape or migrations
- security, secrets, or abuse surface
- auth / authority / trust model
- user-visible identity or product meaning
- external side effects (deploys, sending mail, third-party calls)
```

Everything outside this list on in-scope work: proceed, then let the tier's review gate catch it.

## 8. Keep main coherent

A commit should not leave docs claiming one behavior while code does another. If a feature is partially implemented, record current behavior in `docs/agent/current-state.md`; if a decision is unresolved, keep it visible in `docs/alignment-temp/alignment-progress.md` and add an active blocker to the affected slice.
