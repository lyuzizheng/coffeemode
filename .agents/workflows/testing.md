# Testing

Use this workflow for testing and QA tasks.

## Loop

1. Run `.agents/scripts/preflight.sh`.
2. Read `docs/specs/0003-testing-and-ci.md` for the testing policy.
3. Identify the slice and its declared test gates.
4. Use the narrowest test layer that proves the changed behavior:
   - pure utility/hook logic → unit tests (Vitest)
   - API route behavior with mocked backend → integration tests (fast, default)
   - **SQL / migrations / triggers / DB-backed flows → REAL-DB integration tests**
     (`docker compose up -d` + `npm run test:integration` in `web/`) — required,
     not optional; unit mocks cannot see Postgres snapshot/trigger semantics.
   - user-visible flow → E2E (Playwright, post-MVP)
   - visual quality → screenshot comparison (optional, not blocking)
5. **Maintain the integration suite**: when a change touches a DB behavior that
   the suite does not cover yet, EXTEND `web/tests/integration/db.integration.test.ts`
   in the same PR (one test per behavior, real assertions on returned + stored
   values). The suite must be red on the bug and green on the fix.
6. CI must not depend on live backend, API keys, or external services.
7. Report reproducible failures. Do not patch production code as a tester.

## Running the real-DB suite

```text
docker compose up -d          # postgis/postgis + MinIO (repo root)
cd web && npm run db:migrate  # apply 0001→0008 (idempotent)
npm run test:integration      # RUN_INTEGRATION=1; provisions + drops coffeemode_test
```

Full local-stack guide: `docs/agent/local-dev-stack.md`.

## Test file conventions

```text
web/tests/           unit tests
web/tests/integration/  real-Postgres integration suite (RUN_INTEGRATION=1 gate)
web/e2e/             Playwright E2E specs (post-MVP)
web/fixtures/        test fixtures and synthetic data
```
