# Test Kit — Full Local Stack Plan

## Goal
Docker-compose based local kit covering DB, file storage (R2/MinIO), Cloudflare Workers (D1/KV via miniflare/workerd) and Supabase Auth mock; efficient test framework with shared helpers, no duplication; coverage doc mapping every user trace (login/auth + all use cases) to proving tests.

## Current gaps (evidence 2026-08-24)
- `docker-compose.yml` only `postgres`+`minio`; `poi-service`/`image-service` require manual `wrangler dev` (`docs/agent/local-dev-stack.md:51-94`). No compose service for miniflare/workerd, no D1/KV local bindings, no Supabase Auth mock.
- `web/tests/integration/db.integration.test.ts` 892 lines + `images.integration.test.ts` 473 lines duplicate `provisionTestDatabase`, `runMigrations`, `integrationAdminUrl`, `r2Client`, `presignedPutUrl`, constants — no `web/tests/helpers/*`.
- No coverage matrix; `docs/specs/0003-testing-and-ci.md` defines layers but not traceability. Auth flows (`signIn`/`signOut`/`callback` `web/tests/auth/*` are unit-mocked) never integration-proven; POI live search never integration-proven.

## Slices

### S1 testkit-helpers — Shared integration helpers
- Files: `web/tests/helpers/db.ts`, `helpers/r2.ts`, `helpers/auth.ts`, `helpers/fixtures.ts`, `web/tests/setup.ts`, `vitest.config.mts` helpers exclusion
- Refactor `db.integration.test.ts`, `images.integration.test.ts`, `orphan-cleanup.integration.test.ts` to import helpers
- Gates: typecheck, unit, integration

### S2 testkit-compose-mocks — Compose + Cloudflare mocks
- Files: `docker-compose.yml`, `web/.env.example`, `poi-service/wrangler.toml` (local D1/KV ids), `image-service/wrangler.toml`, `docs/agent/local-dev-stack.md`
- Add `compose` services: `miniflare-poi` (D1 `poi-store`, KV `poi-cache`), `miniflare-image` or workerd for image-service with `R2_*` -> MinIO, `supabase-mock` or `supabase/cli` auth emulator (or `web/tests/mocks/supabase.ts` JWT helper)
- Single `docker compose up -d --wait` brings all
- Gates: typecheck, integration, build

### S3 testkit-coverage-doc — Coverage evaluation doc + trace matrix
- Files: `docs/agent/test-coverage.md` (or `docs/specs/0003-testing-and-ci.md` appendix), `.agents/scripts/check-coverage-matrix.sh` (optional deterministic gate)
- Matrix rows: login Apple/Google, session refresh (`web/proxy.ts`), cafe create, nearby list, detail, checkin lifecycle, likes, navigations, image upload/complete, POI search/resolve, 404 recovery, SEO (sitemap/og), rate limiting — columns: layer, file, gate
- Gates: docs semantic review + preflight

## Execution order
S1 first (helpers) → S2 and S3 can parallel after S1 merges (S2 touches compose/docs, S3 touches docs). Auth E2E (`helpers/auth.ts`) part of S1 feeds S2's Supabase mock.

## Ownership
One writer per slice; file sets are disjoint per slice definition. PRs use `Fixes #<issue>` only when all acceptance criteria for that slice's issue are met.

## Verification per slice
- `npm run verify && npm run test:integration && npm run test:integration:images && .agents/scripts/preflight.sh`
- `npm run check:visual` for UI slices (not needed here)
- Independent review required (Standard tier)
