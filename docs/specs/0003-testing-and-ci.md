# 0003. Testing and CI

## Goal

Define the canonical test layers, gate selection, and CI behavior for CoffeeMode
without making unrelated packages or external services part of every change.

## Status

Accepted

## Stable decisions

### Test layers

| Layer | Tool | Proves |
| --- | --- | --- |
| Type | `tsc --noEmit` | Type contracts compile |
| Unit/component | Vitest + React Testing Library | Pure logic and rendered component behavior |
| Mocked integration | Vitest with mocked service boundaries | Route/service contracts without live dependencies |
| Real DB | Vitest + local Postgres/PostGIS | Migrations, SQL, triggers, transactions, and stored state |
| Browser/manual | Playwright or an inspected local build | User-visible route and interaction behavior |
| Visual comparison | Playwright screenshots with reviewed baselines | Optional visual regression evidence; non-blocking until a baseline policy is accepted |

### Test policy

- CI never depends on live backend services, provider keys, private data, or live
  LLM calls.
- Map and external-service tests use static fixtures or mocked boundaries.
- Tests encode intended contracts, not the current implementation.
- A bug fix adds a regression test that fails on the reproduced defect when the
  affected boundary is testable.
- Unit mocks cannot prove SQL semantics. Changes to migrations, embedded SQL,
  triggers, transactions, or DB-backed flows require `npm run test:integration`
  against real Postgres/PostGIS and assertions on returned and stored state.
- User-visible behavior requires browser/manual evidence. Automated pixel
  comparison is optional and non-blocking until canonical baselines exist.

### Relevant local gates

| Changed area | Required local gate |
| --- | --- |
| `web/` logic/UI | focused test, then `cd web && npm run verify` |
| `web/db/`, `web/lib/`, DB-backed routes or integration suite | web gate plus `cd web && npm run test:integration` |
| `poi-service/` | `npm run typecheck && npm test` in `poi-service/` |
| `image-service/` | `npm run typecheck && npm test` in `image-service/` |
| docs, `.agents/`, `.codex/`, CI authority | preflight + harness self-test + required independent semantic review |

Risk and independent-review requirements are defined only in
`.agents/workflows/development-cycle.md`.

### Commands

```text
web: npm run typecheck, lint, check:i18n, test, build, verify
web real DB: npm run db:migrate, npm run test:integration
web browser smoke: npm run check:visual (local/manual evidence; not a required PR job)
services: npm run typecheck, npm test
agent harness: .agents/scripts/preflight.sh, .agents/scripts/harness-self-test.sh
```

### CI design

`.github/workflows/ci.yml` runs on every pull request and push to `main`.
`.agents/scripts/classify-ci-paths.sh` classifies the base/head diff, then stable
jobs run only when relevant:

- `docs-gate`: agent, docs, templates, and harness changes;
- `application-gate`: `web/` changes;
- `integration-gate`: DB/SQL-capable web boundaries and shared-package changes;
- `image-service-gate`: image-service and shared-package changes;
- `poi-service-gate`: poi-service and shared-package changes;
- `ci-gate`: always aggregates selected job results.

The component job names remain stable so existing branch protection receives a
reported success or skipped result on every PR. `ci-gate` is the preferred single
required context after repository protection is migrated.

The old separate workflows and the PR `visual-gate` are removed. The visual job
had no pixel baseline, duplicated install/build work, and could block indefinitely
while installing Chromium. Local browser evidence remains available through
`npm run check:visual` for UI work.

### Agent harness

`.agents/scripts/preflight.sh` checks required sources, script syntax, spec shape,
links, planned slices, skill frontmatter, Codex bindings, and CI structure.
`.agents/scripts/harness-self-test.sh` fault-injects those checks and verifies CI
path classification. Deterministic checks do not self-attest semantic correctness;
agent/docs/CI authority changes require independent semantic review.

## Acceptance criteria

- `npm run verify` remains the full web type/lint/i18n/unit/build gate.
- Real Postgres remains required for DB/SQL behavior.
- CI emits stable required component checks but executes only relevant jobs.
- A docs-only change does not install application/service dependencies.
- A UI-only web change does not start Postgres.
- Browser/visual verification cannot hold a PR indefinitely.
- Agent/docs/CI changes run preflight, harness self-test, and independent semantic
  review.
