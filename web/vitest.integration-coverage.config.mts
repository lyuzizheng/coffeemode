import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.mts";

/**
 * Real-DB coverage ratchet (BRAWUKA-173).
 *
 * `npm run test:coverage` measures the unit suite only: every `RUN_INTEGRATION=1`
 * spec self-skips without the gate, so `lib/db/**` — the layer whose contract is
 * SQL semantics — was measured almost entirely through its mocks
 * (`lib/db/search.ts` reported 2.12% there, 100% against real Postgres). This
 * configuration re-runs the registered real-DB suites and ratchets `lib/db/**`
 * on its own, so the enforced number comes from the tests that execute the DAL.
 *
 * Floors are set just below the measured real-DB baseline, the same convention
 * as the unit floors in `vitest.config.mts` (BRAWUKA-166). Like those, a floor is
 * only lowered with a spec-amending justification in the PR.
 *
 * Run via `npm run test:coverage:integration` (real Postgres/PostGIS + MinIO).
 */
const config = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        // The base config is opt-in (`vitest run --coverage`); this config
        // exists to measure, so it enables collection on its own.
        enabled: true,
        reportsDirectory: "./coverage-integration",
        // A red ratchet is exactly when the report is worth reading; without
        // this, a failing suite suppresses report generation entirely.
        reportOnFailure: true,
        thresholds: {
          lines: 83,
          functions: 88,
          branches: 69,
          statements: 78,
        },
      },
    },
  }),
);

// `mergeConfig` concatenates arrays instead of replacing them, so the coverage
// scope is assigned after the merge: this ratchet must see `lib/db/**` alone,
// not the base config's full `lib/` + `shared/` + `proxy.ts` set.
config.test!.coverage!.include = ["lib/db/**/*.ts"];

export default config;
