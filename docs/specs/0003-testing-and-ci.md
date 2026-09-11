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
web: npm run typecheck, lint, check:structure, check:duplication, check:file-size, check:i18n, test, test:coverage, build, check:bundle, verify, lhci
web real DB: npm run db:migrate, npm run test:integration, npm run test:integration:journey, npm run test:integration:http, npm run test:integration:images, npm run test:integration:all, npm run test:coverage:integration
web browser smoke: npm run test:e2e (Playwright MVP smoke suite), npm run lhci (Lighthouse CI performance budgets), npm run check:visual (local visual render evidence)
services: npm run typecheck, npm test
staging journey: STAGING_DATABASE_URL=<staging postgres> scripts/devops/run-staging-journey.sh --suite <journey|http|db|all> (setup via setup-supabase.mjs, cleanup via web/scripts/cleanup-stale-test-dbs.mjs --apply)
agent harness: .agents/scripts/preflight.sh, .agents/scripts/harness-self-test.sh, .agents/scripts/check-runtime-pins.sh
```

### CI design

`.github/workflows/ci.yml` runs on every pull request and push to `main`.
`.agents/scripts/classify-ci-paths.sh` classifies the base/head diff, then stable
jobs run only when relevant. Every tracked path matches exactly one rule in that
classifier — including the deliberately ungated families (`_archive-*/`,
`database-data/`, repository hygiene files), which carry an explicit empty arm
so "no gate" is a recorded decision rather than an omission. A path that holds a
`RUN_INTEGRATION=1` suite, or that such a suite consumes, sets
`integration=true`. `.agents/scripts/check-ci-classification.sh` runs on every PR
(cheap: no dependency install) and fails when a new gated test file, a new path
family, or a registered suite the coverage ratchet does not measure appears
without a routing decision, or when a unit-only path starts scheduling the
DB-backed gate:

- `application-gate`: `web/` changes (typecheck, structure guard — file/function budget, duplication budget, layer boundaries, exemption ratchet — lint, i18n key parity, unit tests, v8 coverage ratchet, build, bundle budget check, bundle analysis, PWA validation, E2E smoke suite, and Lighthouse CI performance budgets against seeded fixtures);
- `integration-gate`: DB/SQL-capable web boundaries and shared-package changes — runs real Postgres DB tests (`npm run test:integration`), real Postgres user-journey tests (`npm run test:integration:journey`), real Postgres HTTP lifecycle tests (`npm run test:integration:http`), and real MinIO/R2 image round-trip (`npm run test:integration:images`) sequentially on one `postgis` service + `docker compose up minio` (merged for efficiency; was `integration-gate` + `images-integration-gate`), then the real-DB coverage ratchet (`npm run test:coverage:integration`) against the same live stack. Branch protection that still requires the legacy `images-integration-gate` name should migrate to `integration-gate` + `ci-gate` (see migration note below);
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

### Runtime pins

`engines.node`, the `typescript` version, and each Worker's
`compatibility_date` are a declared, machine-checked contract, not a property of
whichever machine ran the install. `.agents/scripts/check-runtime-pins.sh` (in
preflight, and in the always-running `changes` CI job alongside the classifier
check — no dependencies, so it never self-skips) enforces:

- **Node floor**: `web/`, `poi-service/`, and `image-service/` each declare the
  same `engines.node` floor as a `>=MAJOR[.MINOR[.PATCH]]` range, and that major
  matches every `node-version` in `ci.yml`, `web/Dockerfile`, and the
  `node:*` images in `docker-compose.yml`. CI's `node-version: 22` is the
  authoritative floor; a range the gate cannot read as a floor (a caret, a
  disjunction, `*`) fails rather than being mis-read as consistent.
- **TypeScript**: one declared range across the three packages, one version
  resolved in all three lockfiles, and the declared range's major equal to the
  resolved version's — so "aligned" is a property of the installed tree, not
  just of `package.json`. A deliberate fork must be recorded here first.
- **Worker runtime**: both `wrangler.toml` files pin a valid ISO
  `compatibility_date` that is not in the future. A future date does not fail the
  build; it silently adopts compatibility flags as Cloudflare ships them, which
  is exactly the drift the pin prevents. The two services are not required to
  share a date: image-service enables `nodejs_compat` (which needs
  `compatibility_date >= 2024-09-23` for v2 semantics) and poi-service does not.

`engine-strict` is deliberately **not** enabled. Measured on npm 11: an
unsatisfiable `engines` range without it is an `EBADENGINE` warning and `npm ci`
still exits 0. Enabling it would hard-fail a contributor's local install on an
older Node while changing nothing in CI, where the version is controlled — so the
pin is enforced by this gate instead of by the installer.

### Branch protection & PR review contract

Repository branch protection on `main` enforces stability without blocking automated agent delivery:

- **Required status checks**: `ci-gate` is the mandatory required check context with `strict: true`. Every pull request must be synchronized with the latest `main` branch HEAD and obtain a green `ci-gate` aggregate result before merging.
- **Administrator enforcement**: `enforce_admins: true` ensures administrator credentials cannot bypass the `ci-gate` requirement.
- **GitHub PR approvals**: `requiresApprovingReviews: false` (disabled). In the current Multica workspace environment, all agents push branches and author pull requests using the repository owner's GitHub credentials (`lyuzizheng`). Because GitHub strictly forbids PR self-approval (`Review Can not approve your own pull request`), enabling GitHub-native `required_approving_review_count` would structurally block all automated PR merges.
- **Review enforcement boundary**: Independent code review is enforced semantically and procedurally at Layer 2 within the Multica closed loop (`.agents/workflows/closed-loop.md` and `.agents/workflows/review-code.md`). An independent reviewer agent audits the cumulative diff and test gate evidence, delivering an explicit `Review verdict: APPROVED` on the Multica issue thread before merge authority is granted. Agents MUST NOT invoke `gh pr review --approve` on PRs created under the shared workspace credentials.
- **Future upgrade path**: If GitHub-native approval enforcement (`required_approving_review_count: 1`) is introduced in the future, a dedicated GitHub App or bot account must first be provisioned for Reviewer & Architect so that the reviewer identity differs from the PR author identity.

### Agent harness

`.agents/scripts/preflight.sh` checks required sources, script syntax, spec shape,
links, planned slices, skill frontmatter, Codex bindings, changed-path
classification, runtime pins, CI structure, and the web structure guard (via
`.agents/scripts/check-structure.sh`, self-skipping when web dependencies are
absent).
`.agents/scripts/harness-self-test.sh` fault-injects those checks and verifies CI
path classification. Deterministic checks do not self-attest semantic correctness;
agent/docs/CI authority changes require independent semantic review.

### Structure gate

`cd web && npm run check:structure` runs four checks in parallel and exits
non-zero if any fails:

- **ESLint structural rules** (`web/eslint.config.mjs`): per-file and per-function
  line budgets, block nesting depth, positional parameter count, cognitive
  complexity, identical function bodies, and layer boundaries — `app/api` may not
  import the database driver or embed raw SQL, `components` may not import
  `lib/db` at runtime, `lib/db` may not import `components`. `npm run lint`
  reports the same rules, so a violation is never visible in only one gate.
- **Suppression ratchet** (`npm run check:suppressions`): the rule-level registry
  `web/eslint-suppressions.json` may only shrink. ESLint reads its own
  suppressions file, so without this check `npx eslint --suppress-all` would
  silence the structural rules in one command. The check compares the registry
  against the `eslintSuppressions` budget in `web/structure-baseline.json` (any
  growth fails), re-runs ESLint against a committed empty registry
  (`web/scripts/empty-suppressions.json`) to fail entries whose rule no longer
  fires, requires the `max-lines` exemptions to match the file-size registry
  exactly, and prints `suppressed violations: N (budget M)` so the frozen debt is
  visible in CI logs.
- **`npm run check:duplication`**: jscpd over hand-written code with the budget in
  `.jscpd.json`; tests, generated output, and the archived apps are excluded.
- **`npm run check:file-size`**: per-file budgets plus the grandfathered registry
  in `web/structure-baseline.json` — a listed file may shrink but never grow, a
  listed file that shrank below its recorded count fails until the registry's
  `lines` is lowered to match (the registry is down-only too, so the ceiling
  actually tightens), an unlisted file over budget fails, and an exemption
  without a file fails.

Both registries are only-shrink and are read by the checks above, never by
`web/eslint.config.mjs` (no rule is switched off by path): file size lives in
`structure-baseline.json.files`, rule-level exemptions live in
`eslint-suppressions.json` with their budget alongside. Granting an exemption
therefore edits both files in one commit and is visible in review.

Thresholds are single-sourced in `web/structure.config.mjs`; policy, pattern
selection, and the exception process are canonical in the code-quality and
module-boundaries spec (`0009`). Pre-existing violations live in
`web/eslint-suppressions.json` (ESLint bulk suppressions), so new code is held to
the full rules while existing debt stays recorded and prunable with
`npx eslint --prune-suppressions`. The `application-gate` runs this gate as a
blocking step and `.agents/scripts/check-ci-workflow.sh` fails preflight if the
step disappears from `ci.yml`. Locally, `.agents/scripts/preflight.sh` runs it
through `.agents/scripts/check-structure.sh`, which self-skips when
`web/node_modules` is absent (docs-only jobs, harness self-test fixture); CI is
authoritative.

### Coverage gate

`npm run test:coverage` (`vitest run --coverage`, v8 provider) enforces
ratchet floors declared in `web/vitest.config.mts` (`lines/functions/branches/
statements`) over `web/lib/**`, `web/shared/**`, and `web/proxy.ts`. Route
shells (`web/app/**`) are excluded: they are thin wrappers proven by mocked
route tests plus the real-DB HTTP journey suites, and line coverage over them
measures file count, not logic. Modules that compile to no executable statement
(type-only, pure re-export) are excluded too — v8 reports them as 0/0 = 100%,
an entry that reads as verified while proving nothing. The `application-gate`
runs the coverage step as blocking, and `.agents/scripts/check-ci-workflow.sh`
fails preflight if the step is removed from `ci.yml`. Floors are set just below
the measured unit-suite baseline; a PR that adds covered code raises the floors
it improves — lowering a floor requires a spec-amending justification in the PR,
never a drive-by edit. Per-file waivers are prohibited.

Unit coverage cannot measure the data layer: every `RUN_INTEGRATION=1` spec
self-skips, so `web/lib/db/**` is exercised only through its mocks there
(`lib/db/search.ts` reported 2.12% under the unit run and 100% against real
Postgres). `npm run test:coverage:integration` therefore runs the registered
real-DB suites once more under the live Postgres/PostGIS + MinIO stack and
enforces its own floors — declared in `web/vitest.integration-coverage.config.mts`
and scoped to `web/lib/db/**`, the layer whose contract is SQL semantics. It runs
blocking in `integration-gate` (reusing the stack that job already starts) and
uploads `web/coverage-integration`; `check-ci-workflow.sh` fails preflight if the
step or its artifact is removed. Every file registered in a `test:integration:*`
script must be measured by this ratchet — asserted by
`.agents/scripts/check-ci-classification.sh`.

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
  Docker-free, and register the file in the matching `test:integration:*` script
  (CI `integration-gate` runs only registered files) plus in
  `test:coverage:integration`, which the real-DB ratchet measures —
  `.agents/scripts/check-ci-classification.sh` fails when the two disagree.
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
- `npm run test:coverage:integration` enforces the real-DB `web/lib/db/**` floors in `web/vitest.integration-coverage.config.mts` under `RUN_INTEGRATION=1`; removing that step or its uploaded report from `ci.yml` fails preflight.
- A changed path that holds (or feeds) a `RUN_INTEGRATION` suite schedules `integration-gate`; `.agents/scripts/check-ci-classification.sh` asserts this on every PR, and fails on any tracked path with no routing rule.
- All three packages declare the same `engines.node` floor as CI and the container images; `.agents/scripts/check-runtime-pins.sh` fails on any divergence, on a missing declaration, or on a floor it cannot parse.
- All three packages declare and resolve one TypeScript version; a per-package major bump fails.
- Both Workers pin a valid, non-future `compatibility_date`; removing it or pushing it into the future fails.
- CI emits stable required component checks but executes only relevant jobs.
- A docs-only change does not install application/service dependencies.
- A UI-only web change does not start Postgres.
- Browser/visual verification cannot hold a PR indefinitely.
- Agent/docs/CI changes run preflight, harness self-test, and independent semantic
  review.
