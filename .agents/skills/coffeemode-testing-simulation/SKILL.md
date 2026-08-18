---
name: coffeemode-testing-simulation
description: Design and run CoffeeMode deterministic tests and simulated user/data flows — including the real-Postgres integration suite. Use when the user asks for testing, QA, simulation, fixtures, flow validation, regression coverage, or asks to run/extend the integration tests.
---

# CoffeeMode Testing Simulation

## Flow

Run `.agents/workflows/testing.md` and the canonical testing policy in `docs/specs/0003-testing-and-ci.md`.

## Layers (narrowest first)

- **Unit** — Vitest + RTL for components/hooks/utils (`web/tests/`).
- **Integration (mocked)** — API routes against mocked backends (fast default).
- **Integration (real DB)** — `npm run test:integration` (RUN_INTEGRATION=1) against
  docker-compose Postgres/PostGIS: migrations 0001→0008, triggers, SQL semantics,
  DB-backed lib flows. **Required for any change touching `web/db/migrations/`,
  embedded SQL, or DB-backed flows** — reasoning-only SQL validation is not accepted.
- **E2E** — Playwright for user-visible flows (post-MVP; rendered-page smoke gate
  is the current browser-level floor).

## Duties

- Run/extend `web/tests/integration/db.integration.test.ts` whenever a change
  adds or alters DB behavior: one real assertion per behavior (both the returned
  value AND the stored state), red on the bug, green on the fix.
- Keep the suite skippable: it must stay green-or-skipped in plain `npm test`
  (no Docker on CI machines).
- Record product ambiguity as an unresolved design item, not an invented assertion.
