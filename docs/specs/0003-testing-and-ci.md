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
| `image-service/` | `npm run typecheck && npm test` in `image-service/`; storage-boundary changes also `cd web && npm run test:integration:images` (real MinIO via docker compose) |
| `web/lib/images/` | web gate plus `cd web && npm run test:integration:images` |
| `poi-service/` | `npm run typecheck && npm test` in `poi-service/` |
| docs, `.agents/`, `.codex/`, CI authority | preflight + harness self-test + required independent semantic review |

Risk and independent-review requirements are defined only in
`.agents/workflows/development-cycle.md`.

### Commands

```text
web: npm run typecheck, lint, check:i18n, test, test:coverage, build, check:bundle, verify, lhci
web real DB: npm run db:migrate, npm run test:integration, npm run test:integration:journey, npm run test:integration:http, npm run test:integration:images, npm run test:integration:all
web browser smoke: npm run test:e2e (Playwright MVP smoke suite), npm run lhci (Lighthouse CI performance budgets), npm run check:visual (local visual render evidence)
services: npm run typecheck, npm test
staging journey: STAGING_DATABASE_URL=<staging postgres> scripts/devops/run-staging-journey.sh --suite <journey|http|db|all> (setup via setup-supabase.mjs, cleanup via web/scripts/cleanup-stale-test-dbs.mjs --apply)
agent harness: .agents/scripts/preflight.sh, .agents/scripts/harness-self-test.sh
```

### CI design

`.github/workflows/ci.yml` runs on every pull request and push to `main`.
`.agents/scripts/classify-ci-paths.sh` classifies the base/head diff, then stable
jobs run only when relevant:

- `application-gate`: `web/` changes (typecheck, lint, i18n key parity, unit tests, v8 coverage ratchet, build, bundle budget check, bundle analysis, PWA validation, E2E smoke suite, and Lighthouse CI performance budgets against seeded fixtures);
- `integration-gate`: DB/SQL-capable web boundaries and shared-package changes — runs real Postgres DB tests (`npm run test:integration`), real Postgres user-journey tests (`npm run test:integration:journey`), real Postgres HTTP lifecycle tests (`npm run test:integration:http`), and real MinIO/R2 image round-trip (`npm run test:integration:images`) sequentially on one `postgis` service + `docker compose up minio` (merged for efficiency; was `integration-gate` + `images-integration-gate`). Branch protection that still requires the legacy `images-integration-gate` name should migrate to `integration-gate` + `ci-gate` (see migration note below);
- `image-service-gate`: image-service and shared-package changes;
- `poi-service-gate`: poi-service and shared-package changes;
- `ci-gate`: always aggregates selected job results.

The component job names remain stable so existing branch protection receives a
reported success or skipped result on every PR. `ci-gate` is the preferred single
required context after repository protection is migrated. The `images-integration-gate`
was merged into `integration-gate` for efficiency — if a branch protection rule still
lists `images-integration-gate` as required, update it to `integration-gate` (or to
`ci-gate` alone) before removing the legacy name; new PRs need no migration.

The old separate workflows and the PR `visual-gate` are removed. The visual job
had no pixel baseline, duplicated install/build work, and could block indefinitely
while installing Chromium. Local browser evidence remains available through
`npm run check:visual` for UI work.

### Branch protection & PR review contract

Repository branch protection on `main` enforces stability without blocking automated agent delivery:

- **Required status checks**: `ci-gate` is the mandatory required check context with `strict: true`. Every pull request must be synchronized with the latest `main` branch HEAD and obtain a green `ci-gate` aggregate result before merging.
- **Administrator enforcement**: `enforce_admins: true` ensures administrator credentials cannot bypass the `ci-gate` requirement.
- **GitHub PR approvals**: `requiresApprovingReviews: false` (disabled). In the current Multica workspace environment, all agents push branches and author pull requests using the repository owner's GitHub credentials (`lyuzizheng`). Because GitHub strictly forbids PR self-approval (`Review Can not approve your own pull request`), enabling GitHub-native `required_approving_review_count` would structurally block all automated PR merges.
- **Review enforcement boundary**: Independent code review is enforced semantically and procedurally at Layer 2 within the Multica closed loop (`.agents/workflows/closed-loop.md` and `.agents/workflows/review-code.md`). An independent reviewer agent audits the cumulative diff and test gate evidence, delivering an explicit `Review verdict: APPROVED` on the Multica issue thread before merge authority is granted. Agents MUST NOT invoke `gh pr review --approve` on PRs created under the shared workspace credentials.
- **Future upgrade path**: If GitHub-native approval enforcement (`required_approving_review_count: 1`) is introduced in the future, a dedicated GitHub App or bot account must first be provisioned for Reviewer & Architect so that the reviewer identity differs from the PR author identity.

### Agent harness

`.agents/scripts/preflight.sh` checks required sources, script syntax, spec shape,
links, planned slices, skill frontmatter, Codex bindings, and CI structure.
`.agents/scripts/harness-self-test.sh` fault-injects those checks and verifies CI
path classification. Deterministic checks do not self-attest semantic correctness;
agent/docs/CI authority changes require independent semantic review.

### Coverage gate

`npm run test:coverage` (`vitest run --coverage`, v8 provider) enforces
ratchet floors declared in `web/vitest.config.mts` (`lines/functions/branches/
statements`) over `web/lib/**`, `web/shared/**`, and `web/proxy.ts`. Route
shells (`web/app/**`) are excluded: they are thin wrappers proven by mocked
route tests plus the real-DB HTTP journey suites, and line coverage over them
measures file count, not logic. The `application-gate` runs the coverage step
as blocking, and `.agents/scripts/check-ci-workflow.sh` fails preflight if the
step is removed from `ci.yml`. Floors are set just below the measured
unit-suite baseline; a PR that adds covered code raises the floors it
improves — lowering a floor requires a spec-amending justification in the PR,
never a drive-by edit. Per-file waivers are prohibited.

### Test maintenance contract

How tests evolve when features land (one writer per change, per `AGENTS.md`):

- New user trace → new row in `docs/agent/test-coverage.md` (§5 slice index
  must cover every READY slice) plus a proving test at the cheapest layer
  that can prove the contract: `unit`/`mocked` first, `integration` when the
  change touches migrations, embedded SQL, triggers, transactions, or stored
  state, `browser` evidence (`npm run check:visual`) when user-visible
  behavior changes.
- New production helper used by ≥2 suites → move it to `web/tests/helpers/*`
  (infra: `db`/`r2`; service: `auth`/`fixtures`) instead of duplicating it;
  helpers never embed product logic.
- New integration suite → provision via `provisionTestDatabase` and drop via
  `cleanupIntegrationDatabase` in `afterAll`; gate the file on
  `RUN_INTEGRATION` with `describe.skip` by default so `npm test` stays
  Docker-free, and register the file in the matching `test:integration:*`
  script (CI `integration-gate` runs only registered files).
- New staging-affecting flow → extend `scripts/devops/run-staging-journey.sh`
  suites and `docs/devops/LIFECYCLE.md`, never point integration helpers at
  staging without `ALLOW_REMOTE_INTEGRATION_DB=1`.
- Bug fix → regression test that fails on the reproduced defect when the
  affected boundary is testable (unit/mocked for logic, real-DB for SQL).


### Appendix — Coverage traceability

The traceability matrix lives at `docs/agent/test-coverage.md` (S3 testkit-coverage-doc). It maps every user trace — login Apple/Google, session refresh (`web/proxy.ts`), cafe create, nearby list, detail, check-in lifecycle (create/edit/delete), likes, navigations, image upload/complete, POI search/resolve, 404 recovery, SEO (sitemap/OG), rate limiting — to `Trace × Spec × Layer (unit/mocked/integration/browser) × Proving file × Gate`. Efficiency notes record no-duplication via `web/tests/helpers/*` and the infra (`db`/`r2`) vs service (`auth`/`fixtures`/`workers`) helper split; residual gaps (auth E2E still mocked until Supabase local, POI live search mocked, Workers local via `wrangler dev`, browser E2E manual) are listed there. The deterministic gate `.agents/scripts/check-coverage-matrix.sh` validates completeness (every `READY` slice has ≥1 row) and can be run in CI or as `preflight` follow-on.

## Acceptance criteria

- `npm run verify` remains the full web type/lint/i18n/unit/build/bundle-budget gate.
- Lighthouse CI enforces performance (>= 80 on cafe detail per spec 0001:1182), accessibility, best practices, and SEO budgets against seeded deterministic fixtures.
- The bundle budget measures the clean build output across all of `.next/static` against typed limits in `web/config/app.yaml`.
- Real Postgres remains required for DB/SQL behavior.
- `npm run test:coverage` enforces the v8 ratchet floors in `web/vitest.config.mts`; removing the coverage step from `ci.yml` fails preflight.
- CI emits stable required component checks but executes only relevant jobs.
- A docs-only change does not install application/service dependencies.
- A UI-only web change does not start Postgres.
- Browser/visual verification cannot hold a PR indefinitely.
- Agent/docs/CI changes run preflight, harness self-test, and independent semantic
  review.
