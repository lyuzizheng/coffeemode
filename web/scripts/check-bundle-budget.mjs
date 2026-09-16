#!/usr/bin/env node
/**
 * Bundle budget checker (DG107).
 *
 * Ensures total and individual client chunk sizes in `.next/static` stay within
 * agreed performance budgets defined in `web/config/app.yaml`.
 *
 * Scans all static assets recursively (.next/static, including chunks/, media/,
 * and build manifests) to guarantee no uncounted asset regressions.
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(root, ".next", "static");
const appYamlPath = join(root, "config", "app.yaml");

if (!existsSync(staticDir)) {
  console.error("No build found in web/.next/static — run `npm run build` first.");
  process.exit(1);
}

// Read budgets from config (DG107)
let maxJsChunkBytes = 400 * 1024;
let maxCssChunkBytes = 500 * 1024;
let maxTotalStaticBytes = 5 * 1024 * 1024;
// Per-chunk exemptions (map-home, BRAWUKA-311): a JS chunk whose CONTENT
// contains `marker` may grow to `maxBytes`. Markers must be string literals
// that survive minification (e.g. maplibre-gl's `maplibregl-` CSS classes).
let chunkExemptions = [];

try {
  const yamlContent = readFileSync(appYamlPath, "utf8");
  const parsed = parse(yamlContent);
  const bundleBudgets = parsed?.budgets?.bundle;
  if (bundleBudgets) {
    if (typeof bundleBudgets.maxJsChunkBytes === "number") {
      maxJsChunkBytes = bundleBudgets.maxJsChunkBytes;
    }
    if (typeof bundleBudgets.maxCssChunkBytes === "number") {
      maxCssChunkBytes = bundleBudgets.maxCssChunkBytes;
    }
    if (typeof bundleBudgets.maxTotalStaticBytes === "number") {
      maxTotalStaticBytes = bundleBudgets.maxTotalStaticBytes;
    }
    if (Array.isArray(bundleBudgets.chunkExemptions)) {
      chunkExemptions = bundleBudgets.chunkExemptions.filter(
        (e) => typeof e?.marker === "string" && typeof e?.maxBytes === "number",
      );
    }
  }
} catch (err) {
  console.warn(`[budget-check] Warning: failed to parse config/app.yaml: ${err.message}. Using defaults.`);
}

/** Effective JS cap for one file: the largest exemption whose marker the
 * chunk content contains, else the global cap. Content match (not filename)
 * because chunk names are content hashes. */
function jsBudgetFor(filePath) {
  if (chunkExemptions.length === 0) return maxJsChunkBytes;
  const content = readFileSync(filePath, "utf8");
  let cap = maxJsChunkBytes;
  for (const { marker, maxBytes } of chunkExemptions) {
    if (content.includes(marker)) cap = Math.max(cap, maxBytes);
  }
  return cap;
}

function getAllFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = getAllFiles(staticDir);
let totalBytes = 0;
const violations = [];

for (const filePath of allFiles) {
  const relPath = relative(staticDir, filePath);
  const stat = statSync(filePath);
  totalBytes += stat.size;

  if (filePath.endsWith(".js")) {
    const cap = jsBudgetFor(filePath);
    if (stat.size > cap) {
      violations.push(
        `JS file ${relPath} (${(stat.size / 1024).toFixed(1)} KB) exceeds budget of ${(cap / 1024).toFixed(1)} KB`,
      );
    }
  } else if (filePath.endsWith(".css") && stat.size > maxCssChunkBytes) {
    violations.push(
      `CSS file ${relPath} (${(stat.size / 1024).toFixed(1)} KB) exceeds budget of ${(maxCssChunkBytes / 1024).toFixed(1)} KB`,
    );
  }
}

if (totalBytes > maxTotalStaticBytes) {
  violations.push(
    `Total static assets (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) exceed budget of ${(maxTotalStaticBytes / (1024 * 1024)).toFixed(2)} MB`,
  );
}

if (violations.length > 0) {
  console.error("\n❌ Bundle budget violations:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(
  `\n✅ Bundle budget passed: ${allFiles.length} static assets analyzed (${(totalBytes / 1024).toFixed(1)} KB total across .next/static, all within budgets).`,
);
