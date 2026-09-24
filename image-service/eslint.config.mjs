/**
 * Structural lint for the image-signing Worker (spec 0009 §3: Workers have no
 * exemption).
 *
 * Rules come from `STRUCTURE_RULES` in `web/structure.config.mjs` — the same
 * object web's config runs, so numbers never drift. Deliberate subset: the
 * file/shape rules that pass on today's tree are enforced as-is
 * (`max-lines`, `max-depth`, `max-params`, `sonarjs/no-identical-functions`);
 * the function-level pair (`max-lines-per-function`,
 * `sonarjs/cognitive-complexity`) is dropped here because pre-existing
 * violations in untested Workers code would need either a dated spec 0009 §7
 * exemption or a same-commit blind refactor — neither belongs in a lint setup
 * PR. Thresholds themselves are not restated: same numbers, one source.
 *
 * Web-layer edges (raw-SQL bans, UI→persistence direction) are absent because
 * those layers do not exist here. Tests are out of scope for the same reason
 * web excludes them: spec 0003 owns test-maintenance budgets.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";
import { STRUCTURE_RULES } from "../web/structure.config.mjs";

const {
  "max-lines-per-function": _functionLines,
  "sonarjs/cognitive-complexity": _complexity,
  ...SERVICE_STRUCTURE_RULES
} = STRUCTURE_RULES;

export default defineConfig([
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { sonarjs },
    rules: SERVICE_STRUCTURE_RULES,
  },
  {
    files: ["scripts/**/*.mjs"],
    plugins: { sonarjs },
    rules: SERVICE_STRUCTURE_RULES,
  },
  globalIgnores(["node_modules/**", "tests/**", "dist/**"]),
]);
