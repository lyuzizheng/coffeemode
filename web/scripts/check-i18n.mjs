#!/usr/bin/env node
// Fails when the en/zh message catalogs drift apart (issue #75).
// next-intl renders raw key paths on MISSING_MESSAGE, so catalog parity is a
// hard gate: any asymmetric key fails CI before it can ship to the UI.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function flatten(value, prefix, out) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

function loadKeys(locale) {
  const file = join(root, "messages", `${locale}.json`);
  return flatten(JSON.parse(readFileSync(file, "utf8")), "", new Set());
}

const en = loadKeys("en");
const zh = loadKeys("zh");

const missingInZh = [...en].filter((key) => !zh.has(key)).sort();
const missingInEn = [...zh].filter((key) => !en.has(key)).sort();

if (missingInZh.length > 0 || missingInEn.length > 0) {
  console.error("i18n catalog drift detected:");
  for (const key of missingInZh) console.error(`  missing in zh.json: ${key}`);
  for (const key of missingInEn) console.error(`  missing in en.json: ${key}`);
  process.exit(1);
}

console.log(`i18n catalogs in parity (${en.size} keys each).`);
