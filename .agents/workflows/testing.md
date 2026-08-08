# Testing

Use this workflow for testing and QA tasks.

## Loop

1. Run `.agents/scripts/preflight.sh`.
2. Read `docs/specs/0003-testing-and-ci.md` for the testing policy.
3. Identify the slice and its declared test gates.
4. Use the narrowest test layer that proves the changed behavior:
   - pure utility/hook logic → unit tests (Vitest)
   - API route behavior → integration tests with mocked backend
   - user-visible flow → E2E (Playwright, post-MVP)
   - visual quality → screenshot comparison (optional, not blocking)
5. CI must not depend on live backend, API keys, or external services.
6. Report reproducible failures. Do not patch production code as a tester.

## Test file conventions

```text
web/tests/           unit and integration tests
web/e2e/             Playwright E2E specs (post-MVP)
web/fixtures/        test fixtures and synthetic data
```
