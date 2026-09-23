import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.mts";

/**
 * Real-DB coverage ratchet (BRAWUKA-173).
 *
 * `npm run test:coverage:integration` runs the registered real-DB suites under
 * the live Postgres/PostGIS + MinIO stack and ratchets `web/lib/db/**` — the
 * layer whose contract is SQL semantics — on its own, so the enforced number
 * comes from the tests that execute the DAL.
 *
 * Floors are set just below the measured real-DB baseline; a floor is only
 * lowered with a spec-amending justification in the PR.
 *
 * Run via `npm run test:coverage:integration` (real Postgres/PostGIS + MinIO).
 */
const config = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary", "html"],
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

// The coverage scope is assigned after the merge rather than inside it: this
// ratchet must see `lib/db/**` alone, and assigning post-merge keeps the scope
// exact regardless of what the base config declares.
config.test!.coverage!.include = ["lib/db/**/*.ts"];

export default config;
