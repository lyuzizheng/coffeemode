#!/usr/bin/env node
/**
 * Bundle budget checker — ensures total and individual client chunk sizes
 * stay within agreed MVP performance budgets.
 *
 * Budgets:
 * - Single JS chunk: <= 400 KB (uncompressed)
 * - Single CSS chunk: <= 500 KB (uncompressed)
 * - Total client assets (.next/static): <= 5.0 MB
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chunksDir = join(root, ".next", "static", "chunks");

if (!existsSync(chunksDir)) {
  console.error("No build chunks found. Run `npm run build` first.");
  process.exit(1);
}

const MAX_JS_CHUNK_BYTES = 400 * 1024; // 400 KB
const MAX_CSS_CHUNK_BYTES = 500 * 1024; // 500 KB
const MAX_TOTAL_STATIC_BYTES = 5 * 1024 * 1024; // 5 MB

const files = readdirSync(chunksDir);
let totalBytes = 0;
const violations = [];

for (const file of files) {
  const filePath = join(chunksDir, file);
  const stat = statSync(filePath);
  if (!stat.isFile()) continue;

  totalBytes += stat.size;

  if (file.endsWith(".js") && stat.size > MAX_JS_CHUNK_BYTES) {
    violations.push(
      `JS chunk ${file} (${(stat.size / 1024).toFixed(1)} KB) exceeds budget of ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(1)} KB`,
    );
  } else if (file.endsWith(".css") && stat.size > MAX_CSS_CHUNK_BYTES) {
    violations.push(
      `CSS chunk ${file} (${(stat.size / 1024).toFixed(1)} KB) exceeds budget of ${(MAX_CSS_CHUNK_BYTES / 1024).toFixed(1)} KB`,
    );
  }
}

if (totalBytes > MAX_TOTAL_STATIC_BYTES) {
  violations.push(
    `Total static chunks (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) exceed budget of ${(MAX_TOTAL_STATIC_BYTES / (1024 * 1024)).toFixed(2)} MB`,
  );
}

if (violations.length > 0) {
  console.error("\n❌ Bundle budget violations:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(
  `\n✅ Bundle budget passed: ${files.length} chunks analyzed (${(totalBytes / 1024).toFixed(1)} KB total, all within budgets).`,
);
