#!/usr/bin/env node
/**
 * Generate `../deploy/dokploy/cache-rules.json` from `config/app.yaml`
 * (`seo.shellCache`) via `lib/cache-policy.ts` `cafeShellCdnRules()`
 * (BRAWUKA-821).
 *
 * The YAML + cache-policy module are the single source of truth for the
 * /cafes/* CDN cache contract. Editing the contract is one edit (the YAML)
 * plus re-running this script:
 *
 *   npm run gen:cache-rules
 *
 * Freshness is enforced by `--check`, which re-renders the artifact in
 * memory and compares it byte-for-byte against the committed file without
 * rewriting it: `npm run check:cache-rules` runs in the `application-static`
 * CI job (step pinned by `.agents/scripts/check-ci-workflow.sh`) and in
 * `npm run verify`, so a stale artifact fails the PR instead of silently
 * drifting — the same convention as `generate-rate-limit-buckets.mjs`
 * (BRAWUKA-746).
 *
 * The TS entry (`scripts/lib/generate-cache-rules.ts`) is bundled to
 * `scripts/dist/` by esbuild on every run — a stale bundle must never mask
 * source drift, so this script always rebuilds.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");
const ENTRY = path.join(__dirname, "lib", "generate-cache-rules.ts");
const BUNDLE = path.join(__dirname, "dist", "generate-cache-rules.mjs");
const OUT_FILE = path.join(WEB_ROOT, "..", "deploy", "dokploy", "cache-rules.json");

// loadYaml() resolves config files from cwd — pin it to web/ so the script
// behaves identically from `web/` and the repo root.
process.chdir(WEB_ROOT);

async function buildBundle() {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    alias: { "server-only": path.join(__dirname, "lib", "server-only-stub.mjs") },
    tsconfig: path.join(WEB_ROOT, "tsconfig.json"),
    logLevel: "warning",
  });
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  await buildBundle();
  const { renderCacheRulesJson } = await import(pathToFileURL(BUNDLE).href);
  const rendered = renderCacheRulesJson();
  const committed = readFileSync(OUT_FILE, "utf8");
  if (checkOnly) {
    if (rendered !== committed) {
      console.error(
        "❌ deploy/dokploy/cache-rules.json is stale: re-run `npm run gen:cache-rules` after editing web/config/app.yaml or web/lib/cache-policy.ts.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("✅ deploy/dokploy/cache-rules.json matches web/config/app.yaml seo.shellCache.");
    return;
  }
  if (rendered === committed) {
    console.log("deploy/dokploy/cache-rules.json already up to date.");
    return;
  }
  writeFileSync(OUT_FILE, rendered);
  console.log("wrote", path.relative(process.cwd(), OUT_FILE));
}

main().catch((err) => {
  console.error(err?.stack ?? err?.message ?? err);
  process.exitCode = 1;
});
