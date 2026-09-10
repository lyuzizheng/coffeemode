/**
 * Structure guard thresholds — the single machine-readable source of truth.
 *
 * Canonical policy and rationale: the code-quality & module-boundaries spec
 * (`docs/specs/0009`). Consumed by:
 *   - `web/eslint.config.mjs`          (structural ESLint rules + layer boundaries)
 *   - `web/scripts/check-file-size.mjs` (file budget + grandfathered ratchet)
 *   - `web/scripts/check-structure.mjs` (unified `npm run check:structure`)
 *   - `web/.jscpd.json` is mirrored from `duplication` below (jscpd reads JSON, not JS)
 *
 * These are build-time code-shape limits, not runtime product parameters: DG107
 * product config under `web/config/` stays untouched.
 */
import { readFileSync } from "node:fs";

export const LIMITS = Object.freeze({
  /** Hand-written application sources: hard/soft line budget per file. */
  maxLines: 400,
  softLines: 250,
  /** Longest single function body. */
  maxLinesPerFunction: 80,
  /** Nested block depth inside a function. */
  maxDepth: 4,
  /** Positional parameters before a parameter object is required. */
  maxParams: 5,
  /** sonarjs cognitive complexity per function. */
  cognitiveComplexity: 15,
  /** Minimum body length for `sonarjs/no-identical-functions`. */
  identicalFunctionLines: 3,
  /** jscpd budgets; mirrored in `web/.jscpd.json`. */
  duplication: Object.freeze({
    threshold: 3,
    minLines: 5,
    minTokens: 50,
  }),
});

/**
 * Files the structural rules are applied to. Tests are deliberately absent:
 * spec 0003 owns test-maintenance budgets, and long linear test files are not
 * the code-shape risk this guard exists for. Generated output is ignored by
 * `eslint.config.mjs` global ignores.
 */
export const SOURCE_GLOBS = Object.freeze([
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,mts}",
  "shared/**/*.{ts,mts}",
  "config/**/*.{ts,mts}",
  "scripts/**/*.{mjs,ts}",
  "*.{ts,mts,mjs}",
]);

/** Root directories and extensions `scripts/check-file-size.mjs` walks. */
export const SOURCE_SCAN = Object.freeze({
  roots: Object.freeze(["app", "components", "lib", "shared", "config", "scripts"]),
  extensions: Object.freeze([".ts", ".tsx", ".mts", ".mjs"]),
  rootFiles: true,
  ignoredDirs: Object.freeze(["node_modules", ".next", "tests", "__tests__", "coverage"]),
  testPattern: /\.(test|spec)\.[cm]?[jt]sx?$/u,
});

/** Layer boundary rules enforced by `@typescript-eslint/no-restricted-imports`. */
export const LAYER_BOUNDARIES = Object.freeze([
  Object.freeze({
    id: "api-no-driver",
    files: Object.freeze(["app/api/**/*.{ts,tsx}"]),
    group: Object.freeze(["pg", "pg-*", "postgres", "postgres-*"]),
    message:
      "Route handlers must not talk to the database driver (layer boundary: app/api -> lib/db). Call a `lib/db/*` helper instead.",
  }),
  Object.freeze({
    id: "ui-no-persistence",
    files: Object.freeze(["components/**/*.{ts,tsx}"]),
    group: Object.freeze(["@/lib/db/**", "**/lib/db/**"]),
    message:
      "Client components must not import the persistence layer at runtime (layer boundary: components -/-> lib/db). Type-only imports stay allowed; move shared DTOs out of lib/db when you need more.",
  }),
  Object.freeze({
    id: "persistence-no-ui",
    files: Object.freeze(["lib/db/**/*.{ts,mts}"]),
    group: Object.freeze(["@/components/**", "**/components/**"]),
    message:
      "The persistence layer must not import UI (layer boundary: lib/db -/-> components).",
  }),
]);

/** Raw SQL is only allowed behind `lib/db` / `lib/*` query helpers. */
export const SQL_IN_API_FILES = Object.freeze(["app/api/**/*.{ts,tsx}"]);
export const SQL_LITERAL_SELECTOR =
  "TemplateLiteral > TemplateElement[value.raw=/\\b(select|insert[ \\t]+into|update|delete[ \\t]+from|alter[ \\t]+table|drop[ \\t]+table)\\b/i]";

/** ESLint rule ids owned by this guard; `check:structure` reports only these. */
export const STRUCTURAL_RULE_IDS = Object.freeze([
  "max-lines",
  "max-lines-per-function",
  "max-depth",
  "max-params",
  "sonarjs/cognitive-complexity",
  "sonarjs/no-identical-functions",
  "@typescript-eslint/no-restricted-imports",
  "no-restricted-syntax",
]);

const baselinePath = new URL("./structure-baseline.json", import.meta.url);

/** Grandfathered exemptions; see `web/structure-baseline.json` header. */
export function loadGrandfathered() {
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  return parsed.files;
}
