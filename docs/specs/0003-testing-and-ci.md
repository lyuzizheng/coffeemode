# 0003. Testing and CI Spec

## Goal

Define how CoffeeMode tests application behavior, gates changes through CI, and automates the development workflow — adapted from CanCan's proven harness model to CoffeeMode's web-app scale.

## Status

Accepted

## Stable decisions

### Test layers

```text
Unit:        Vitest + React Testing Library for components, hooks, utils
Integration: two kinds —
             a) API routes with mocked backend (fast, default)
             b) REAL-DB integration (Vitest against docker-compose Postgres/PostGIS):
                migrations 0001→0008, triggers, SQL semantics, DB-backed lib flows.
                Opt-in via RUN_INTEGRATION=1 (web/tests/integration); skipped in
                plain `npm test`. Stack: docker-compose.yml + web/scripts/migrate.mjs —
                see docs/agent/local-dev-stack.md.
E2E:         Playwright for critical user flows (map, search, cafe detail) — post-MVP
Visual:      Playwright screenshots for key surfaces (optional, not blocking —
             pixel baselines; distinct from the blocking rendered-page smoke gate below)
```

### When real-DB integration is required

```text
ANY change that touches:
  - web/db/migrations/*.sql          (every migration must apply + its triggers work)
  - SQL embedded in web/lib/**       (CTEs, triggers, transactions — unit mocks
                                      cannot see snapshot/trigger semantics)
  - DB-backed lib flows               (toggleCheckInLike, stats aggregation, fused
                                      cafe+checkin tx, image-upload intents)
MUST declare the `integration` test gate on its slice and run
`npm run test:integration` green locally (or extend the suite when the behavior
is not yet covered). Reasoning-only SQL validation is not acceptable.

E2E (Playwright) is required for user-visible flows once the UI exists; until
then the rendered-page smoke gate (check:visual) is the browser-level floor.
```

### Test policy

```text
- CI must not depend on the live Java backend
- CI must not depend on Google Maps API keys
- Map tests use a static/mock map provider
- API route tests mock the backend fetch boundary
- LLM-dependent features (future) use stored fixtures, never live calls
```

### Fixture layers

```text
web/fixtures/        test fixtures and synthetic data (reserved for future use)
```

No private fixtures needed (no financial data). Synthetic fixtures model real cafe data shapes.
The image-pipeline tests generate small synthetic WebP images on the fly, so no committed fixtures are needed yet.

### CI gates

Every PR and push to main runs the strongest relevant subset:

```text
typecheck        tsc --noEmit
lint             eslint
unit             vitest run
build            next build
e2e              playwright test (critical paths only) — post-MVP
```

### Consequence-based execution

Adapted from CanCan's three-tier model:

```text
Fast:     localized fix, no contract change
          -> focused test + typecheck + lint, PR CI covers the rest

Standard: behavior change with bounded consequences
          -> one writer, focused tests, optional independent review

High:     data model change, auth flow, API contract, deployment
          -> one writer, required review, full CI gate
```

Risk follows consequences, not line count.

### Done criteria

A feature is not done until:

```text
- typecheck passes
- relevant tests pass
- build succeeds
- UI was visually inspected if UI changed
- docs/specs are updated if behavior changed
- progress log is updated
```

### Automation scripts

```text
npm run typecheck       TypeScript check
npm run lint            ESLint
npm run test            Vitest unit tests
npm run db:migrate      apply web/db/migrations/*.sql to the compose Postgres
                        (scripts/migrate.mjs; tracked in schema_migrations)
npm run test:integration  real-Postgres integration suite (RUN_INTEGRATION=1);
                        provisions + drops a throwaway coffeemode_test DB;
                        skipped in plain `npm test`
npm run check:i18n      en/zh message-catalog key parity (scripts/check-i18n.mjs)
npm run check:visual    rendered-page smoke: production build + Playwright chromium over
                        the public route matrix (scripts/visual-smoke.mjs); not in verify —
                        needs a browser install, so it runs as its own CI gate
npm run build           Next.js production build
npm run verify          check:i18n + typecheck + lint + test + build (the full gate)
```

### CI workflow design

```text
.github/workflows/application.yml:
  triggers: PR + push to main (web/**, .github/workflows/application.yml)
  steps: npm ci, npm run typecheck, npm run lint, npm run check:i18n, npm run test, npm run build
  concurrency: cancel superseded runs

.github/workflows/visual.yml:
  triggers: PR + push to main (web/**, .github/workflows/visual.yml)
  steps: npm ci, npm run build, playwright install chromium, npm run check:visual,
         upload screenshots artifact on failure
  notes: rendered-page smoke — 4 public routes x light/dark x mobile/desktop,
         fails on unexpected per-route HTTP status (the 404 fixture must
         return 404), console errors, or page errors; no pixel baselines yet

.github/workflows/poi-service.yml:
  triggers: PR + push to main (poi-service/**, .github/workflows/poi-service.yml)
  runs: npm ci && npm run typecheck && npm test

.github/workflows/image-service.yml:
  triggers: PR + push to main (image-service/**, .github/workflows/image-service.yml)
  runs: npm ci && npm run typecheck && npm test

.github/workflows/docs-harness.yml:
  triggers: PR + push to main (AGENTS.md, .agents/**, .codex/**, docs/**, .github/workflows/docs-harness.yml)
  runs: .agents/scripts/preflight.sh
  permissions: contents: read
```

### Agent harness

```text
.agents/scripts/preflight.sh verifies:
  - required entry files exist (AGENTS.md, docs/STRUCTURE.md, docs/specs/README.md)
  - shell scripts parse with bash -n
  - spec numbers are unique
  - every spec has required headings (Goal, Stable decisions, Acceptance criteria)
  - every spec appears in docs/specs/README.md
  - local markdown links resolve
  - implementation slice IDs are valid
```

## Acceptance criteria

```text
- npm run verify runs typecheck + lint + test + build in one command
- npm run test:integration validates migrations + triggers + DB flows against a
  real Postgres/PostGIS (docker-compose), opt-in so CI without Docker stays green
- Every migration change ships with a green integration run (no reasoning-only SQL)
- CI runs on every PR and blocks merge on failure
- No live backend or API key dependency in CI
- Docs changes trigger the docs harness gate
- Consequence-based execution prevents over-engineering small changes
- Every spec is machine-checked for format compliance
```
