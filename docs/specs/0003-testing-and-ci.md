# 0003. Testing and CI Spec

## Goal

Define how CoffeeMode tests application behavior, gates changes through CI, and automates the development workflow — adapted from CanCan's proven harness model to CoffeeMode's web-app scale.

## Status

Accepted

## Stable decisions

### Test layers

```text
Unit:        Vitest + React Testing Library for components, hooks, utils
Integration: Vitest for API routes with mocked backend
E2E:         Playwright for critical user flows (map, search, cafe detail)
Visual:      Playwright screenshots for key surfaces (optional, not blocking)
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
fixtures/
  synthetic/       generated safe samples, preferred for CI
  snapshots/       Playwright visual snapshots (committed after review)
```

No private fixtures needed (no financial data). Synthetic fixtures model real cafe data shapes.

### CI gates

Every PR and push to main runs the strongest relevant subset:

```text
typecheck        tsc --noEmit
lint             eslint + prettier check
unit             vitest run
build            next build
e2e              playwright test (critical paths only)
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
pnpm typecheck          TypeScript check
pnpm lint               ESLint + Prettier
pnpm test               Vitest unit tests
pnpm test:e2e           Playwright E2E
pnpm build              Next.js production build
pnpm verify             typecheck + lint + test + build (the full gate)
```

### CI workflow design

```text
.github/workflows/application.yml:
  triggers: PR + push to main (apps/**, packages/**, root configs)
  runs: pnpm verify
  concurrency: cancel superseded runs

.github/workflows/docs-harness.yml:
  triggers: PR + push to main (docs/**, .agents/**, AGENTS.md)
  runs: .agents/scripts/preflight.sh
  permissions: contents: read

.github/workflows/backend-ci.yml:
  triggers: PR + push to main (coffeemode_backend/**)
  runs: gradle build (existing, keep)
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
- pnpm verify runs typecheck + lint + test + build in one command
- CI runs on every PR and blocks merge on failure
- No live backend or API key dependency in CI
- Docs changes trigger the docs harness gate
- Consequence-based execution prevents over-engineering small changes
- Every spec is machine-checked for format compliance
```
