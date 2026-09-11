import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // `include` already limits collection to `*.test.*`; `tests/helpers/**` is
    // excluded by that alone — explicit `exclude` remains only for `node_modules`.
    exclude: ["node_modules/**", "**/.next/**", "**/coverage/**"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      // Opt-in via `npm run test:coverage` (`vitest run --coverage`); plain
      // `npm test` collects no coverage and stays fast.
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Production code under test. Route shells (`app/**`) are thin
      // server-component wrappers proven by mocked route tests + real-DB
      // HTTP journey suites, not by line coverage — excluded so the ratchet
      // below measures `lib/`/`db/` logic instead of file count.
      include: ["lib/**/*.ts", "shared/**/*.ts", "proxy.ts"],
      exclude: [
        "tests/**",
        "scripts/**",
        "config/**",
        "**/*.d.ts",
        // Type-only and re-export modules emit no statements, so v8 reports
        // them as 0/0 = 100% — an entry that reads as fully covered while
        // proving nothing. They contribute nothing to the aggregate ratio
        // either; they are excluded so the report lists only measured code
        // (BRAWUKA-173). Add a path here only when it compiles to no
        // executable statement.
        "lib/rate-limit/types.ts",
        "lib/search/distance.ts",
        "lib/search/types.ts",
        "shared/places/types.ts",
      ],
      // Ratchet floors (BRAWUKA-166): measured unit-suite coverage minus a
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 78,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "@shared": path.resolve(import.meta.dirname, "./shared"),
      "server-only": path.resolve(import.meta.dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
