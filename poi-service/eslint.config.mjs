/**
 * Structural lint for the POI Worker (spec 0009 §3: same table as web; stock
 * violations carry dated §7 exemptions in `eslint-suppressions.json`).
 *
 * Rules come from `STRUCTURE_RULES` in `web/structure.config.mjs` — the same
 * object web's config runs, so numbers never drift. The full rule set runs,
 * including the function-level pair (`max-lines-per-function`,
 * `sonarjs/cognitive-complexity`): pre-existing violations are registered as
 * dated spec 0009 §7 exemptions in `eslint-suppressions.json` (budget and
 * `reviewBy` in `structure-baseline.json`, enforced by
 * `npm run check:suppressions`), and any violation not in that registry fails
 * this lint. Thresholds themselves are not restated: same numbers, one source.
 *
 * Web-layer edges (raw-SQL bans, UI→persistence direction) are absent because
 * those layers do not exist here. Tests are out of scope for the same reason
 * web excludes them: spec 0003 owns test-maintenance budgets.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";
import { STRUCTURE_RULES } from "../web/structure.config.mjs";

export default defineConfig([
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { sonarjs },
    rules: STRUCTURE_RULES,
  },
  {
    files: ["scripts/**/*.mjs"],
    plugins: { sonarjs },
    rules: STRUCTURE_RULES,
  },
  globalIgnores(["node_modules/**", "tests/**", "dist/**"]),
]);
