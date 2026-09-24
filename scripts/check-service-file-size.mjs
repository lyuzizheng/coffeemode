#!/usr/bin/env node
/**
 * File budget guard for the Worker services (spec 0009 §3 + Edge cases §4:
 * `poi-service/` and `image-service/` apply the same 250/400 table as web —
 * Workers register zero file-size exemption).
 *
 * Run from the service root; each service's `npm run check:file-size` does
 * exactly that, and both service gates in CI run that script. Walks
 * `SERVICE_SCAN.roots`, fails any non-test source over the hard limit, warns
 * over the soft limit. The ESLint `max-lines` rule enforces the same hard
 * budget from the same `LIMITS`; this script adds the soft budget and a
 * whole-tree summary CI can print.
 *
 * Deliberately reads no exemption registry: the services' gate starts at zero
 * grandfathered files, so a spec 0009 §7 exemption would have to grow this
 * script in the same PR that registers it.
 *
 * Thresholds come from `web/structure.config.mjs`: one number, one owner —
 * the same object web's gate and every service linter import.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { LIMITS, SERVICE_SCAN } from "../web/structure.config.mjs";

const serviceRoot = process.cwd();

function countLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SERVICE_SCAN.ignoredDirs.includes(entry.name)) continue;
      walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SERVICE_SCAN.extensions.includes(extname(entry.name))) continue;
    if (SERVICE_SCAN.testPattern.test(entry.name)) continue;
    files.push(full);
  }
}

function collectSourceFiles() {
  const files = [];
  for (const root of SERVICE_SCAN.roots) {
    const dir = join(serviceRoot, root);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(dir, files);
  }
  return files.sort();
}

const rel = (file) => relative(serviceRoot, file).split(sep).join("/");
const measured = collectSourceFiles().map((file) => ({
  path: rel(file),
  lines: countLines(readFileSync(file, "utf8")),
}));

const errors = [];
const warnings = [];

if (measured.length === 0) {
  // A gate that measures nothing passes silently — the exact failure this
  // script exists to prevent. Treat an empty tree as a broken detector.
  errors.push(`no source files found under ${SERVICE_SCAN.roots.join(", ")} — scan roots missing?`);
}

for (const file of measured) {
  if (file.lines > LIMITS.maxLines) {
    errors.push(`${file.path}: ${file.lines} lines > hard budget ${LIMITS.maxLines} (spec 0009 §4: split in the same commit)`);
  } else if (file.lines > LIMITS.softLines) {
    warnings.push(`${file.path}: ${file.lines} lines > soft budget ${LIMITS.softLines} — reviewer must ask "can this split?"`);
  }
}

for (const warning of warnings) console.log(`warn: ${warning}`);
for (const error of errors) console.log(`FAIL: ${error}`);

const largest = measured.reduce((max, file) => Math.max(max, file.lines), 0);
console.log(
  `service file budget: ${measured.length} files, largest ${largest} lines, hard ${LIMITS.maxLines}, soft ${LIMITS.softLines}, exemptions 0`,
);

if (errors.length > 0) {
  console.log(`file budget check failed (${errors.length} error(s)).`);
  process.exit(1);
}
console.log("file budget check passed.");
