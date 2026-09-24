import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";
import {
  LAYER_BOUNDARIES,
  SOURCE_GLOBS,
  SQL_IN_API_FILES,
  SQL_LITERAL_SELECTOR,
  STRUCTURE_RULES,
} from "./structure.config.mjs";

// Structural rules (spec 0009). `STRUCTURE_RULES` lives in
// `structure.config.mjs` and is shared verbatim with `npm run check:structure`
// and the Worker-service linters, so the docs, every ESLint run, and the CI
// gate can never disagree about a number.

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
    rules: STRUCTURE_RULES,
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
    // esbuild output of scripts/recompute-work-stats.mjs (BRAWUKA-664).
    "scripts/dist/**",
  ]),
]);

export default eslintConfig;
