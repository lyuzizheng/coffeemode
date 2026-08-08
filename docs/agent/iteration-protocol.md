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
test strategy (Vitest + RTL + tsc --noEmit; Playwright E2E post-MVP)
required doc updates
```

## 4. Implement in small slices

Size execution by consequence using `.agents/workflows/development-cycle.md`:

- **Fast:** typo/formatting/comment-only — focused checks, then let PR CI cover the rest.
- **Standard:** localized behavior change — one production-code writer, focused tests, at most one independent role that supplies material evidence.
- **High risk:** data correctness, migrations, auth/security/secrets, deployment, or agent-harness authority — one production-code writer, applicable independent review, and one full relevant gate on the final stable diff.

Risk follows consequences, not line count. Never run multiple source-writing agents concurrently.

Prefer slices that produce a verifiable result:

```text
schema migration + unit test
API route + unit test
MapKit component + Playwright flow
POI Worker + unit test against wrangler dev
upload pipeline + fixture images
```

## 5. Validate like an autonomous coding agent

Each slice should have a clear validation artifact:

```text
typecheck (tsc --noEmit)
Vitest unit/component tests
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

## 7. Ask when blocked

If a decision affects product meaning, money/pricing display, security, auth, secrets, or irreversible data shape and the docs do not answer it, ask the user instead of guessing.

## 8. Keep main coherent

A commit should not leave docs claiming one behavior while code does another. If a feature is partially implemented, record current behavior in `docs/agent/current-state.md`; if a decision is unresolved, keep it visible in `docs/alignment-temp/alignment-progress.md` and add an active blocker to the affected slice.
