import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration — real-Postgres integration suites only.
 *
 * Testing philosophy (AGENTS.md): E2E is the sole test mechanism; there are no
 * unit tests. Every spec under `tests/` is gated on `RUN_INTEGRATION=1` and
 * self-skips without it, so a bare `vitest run` collects the files and exits
 * green without Docker. The suites are invoked through the `test:integration:*`
 * scripts in `package.json`; `test:coverage:integration` measures them via
 * `vitest.integration-coverage.config.mts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // `include` already limits collection to `*.test.*`; `tests/helpers/**` is
    // excluded by that alone — explicit `exclude` remains only for `node_modules`.
    exclude: ["node_modules/**", "**/.next/**", "**/coverage/**"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Staging-journey worker cap (spec 0010 S4): local and CI integration runs
    // stay uncapped (unset = Vitest default); only run-staging-journey.sh sets
    // VITEST_MAX_WORKERS from web/config/app.yaml staging.maxWorkers.
    ...(process.env.VITEST_MAX_WORKERS !== undefined
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "@shared": path.resolve(import.meta.dirname, "./shared"),
      "server-only": path.resolve(import.meta.dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
