import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";
import {
  LAYER_BOUNDARIES,
  LIMITS,
  SOURCE_GLOBS,
  SQL_IN_API_FILES,
  SQL_LITERAL_SELECTOR,
} from "./structure.config.mjs";

// Structural rules (spec 0009). Thresholds live in `structure.config.mjs` and
// are shared verbatim with `npm run check:structure`, so the docs, ESLint, and
// the CI gate can never disagree about a number.
const structureRules = {
  "max-lines": ["error", { max: LIMITS.maxLines }],
  "max-lines-per-function": ["error", { max: LIMITS.maxLinesPerFunction }],
  "max-depth": ["error", LIMITS.maxDepth],
  "max-params": ["error", LIMITS.maxParams],
  "sonarjs/cognitive-complexity": ["error", LIMITS.cognitiveComplexity],
  "sonarjs/no-identical-functions": ["error", LIMITS.identicalFunctionLines],
};

// Layer boundaries as dependency-direction bans. Type-only imports stay legal:
// they are a compile-time contract, not runtime coupling between layers.
const boundaryBlocks = LAYER_BOUNDARIES.map((boundary) => ({
  files: [...boundary.files],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [...boundary.group],
            allowTypeImports: true,
            message: boundary.message,
          },
        ],
      },
    ],
  },
}));

// Route handlers compose `lib/*` helpers; raw SQL never appears in app/api.
const sqlBlocks = [
  {
    files: [...SQL_IN_API_FILES],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: SQL_LITERAL_SELECTOR,
          message:
            "Raw SQL belongs in `lib/db/*` (layer boundary: app/api -> lib/db). Export a query helper and call it from the route.",
        },
      ],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [...SOURCE_GLOBS],
    plugins: { sonarjs },
    rules: structureRules,
  },
  ...boundaryBlocks,
  ...sqlBlocks,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
