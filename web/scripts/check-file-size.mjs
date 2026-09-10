#!/usr/bin/env node
/**
 * File budget guard + grandfathered ratchet (spec 0009).
 *
 * Fails when:
 *   - a source file exceeds `LIMITS.maxLines` and is not grandfathered;
 *   - a grandfathered file grows past its recorded line count ("only down");
 *   - a grandfathered entry points at a file that no longer exists.
 *
 * Warns when a file crosses the soft budget. The ESLint `max-lines` rule
 * enforces the same hard budget; this script adds the soft budget, the
 * exemption registry, and the ratchet that ESLint cannot express.
 *
 * `--print-baseline` prints the JSON body for `web/structure-baseline.json`
 * from the current tree (never auto-writes: the registry is reviewed).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS, SOURCE_SCAN, loadBaseline } from "../structure.config.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const printBaseline = process.argv.includes("--print-baseline");

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
      if (SOURCE_SCAN.ignoredDirs.includes(entry.name)) continue;
      walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_SCAN.extensions.includes(extname(entry.name))) continue;
    if (SOURCE_SCAN.testPattern.test(entry.name)) continue;
    files.push(full);
  }
}

function collectSourceFiles() {
  const files = [];
  for (const root of SOURCE_SCAN.roots) {
    const dir = join(webRoot, root);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(dir, files);
  }
  if (SOURCE_SCAN.rootFiles) {
    for (const entry of readdirSync(webRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!SOURCE_SCAN.extensions.includes(extname(entry.name))) continue;
      files.push(join(webRoot, entry.name));
    }
  }
  return files.sort();
}

const rel = (file) => relative(webRoot, file).split(sep).join("/");
const measured = collectSourceFiles().map((file) => ({
  path: rel(file),
  lines: countLines(readFileSync(file, "utf8")),
}));

const grandfathered = loadBaseline().files;
const exemptions = new Map(grandfathered.map((entry) => [entry.path, entry]));

const errors = [];
const warnings = [];
const notes = [];

// spec 0009 §7.1/§7.3: a size exemption must carry a review date, and an overdue
// review is a gate failure rather than a note in prose.
for (const entry of grandfathered) {
  if (!entry.reviewBy || Number.isNaN(Date.parse(entry.reviewBy))) {
    errors.push(`${entry.path}: exemption has no reviewBy date — spec 0009 §7.1 requires one`);
  } else if (Date.parse(entry.reviewBy) < Date.now()) {
    errors.push(`${entry.path}: exemption review was due ${entry.reviewBy} (spec 0009 §7.3) — split the file, renew the date, or open a P1 debt issue`);
  }
}

for (const file of measured) {
  const exemption = exemptions.get(file.path);
  if (exemption) {
    exemptions.delete(file.path);
    if (file.lines > exemption.lines) {
      errors.push(
        `${file.path}: ${file.lines} lines, grandfathered at ${exemption.lines} — exemptions may only shrink (split the file instead of growing it)`,
      );
    } else if (file.lines <= LIMITS.maxLines) {
      notes.push(
        `${file.path}: ${file.lines} lines is now within the ${LIMITS.maxLines}-line budget — remove its baseline exemption and let the ratchet take over`,
      );
    } else {
      notes.push(`${file.path}: grandfathered ${file.lines}/${exemption.lines} lines`);
    }
    continue;
  }
  if (file.lines > LIMITS.maxLines) {
    errors.push(
      `${file.path}: ${file.lines} lines exceeds the hard budget of ${LIMITS.maxLines} — split it in this change, or register a reviewed baseline exemption`,
    );
  } else if (file.lines > LIMITS.softLines) {
    warnings.push(`${file.path}: ${file.lines} lines is over the soft budget of ${LIMITS.softLines}`);
  }
}

for (const path of exemptions.keys()) {
  errors.push(`${path}: baseline exemption points at a missing file — delete the exemption`);
}

if (printBaseline) {
  const entries = measured
    .filter((file) => file.lines > LIMITS.maxLines)
    .map((file) => ({
      path: file.path,
      lines: file.lines,
      reason: "over budget before the guard existed — split tracked by the BRAWUKA-175 quality program",
    }));
  process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  process.exit(0);
}

for (const note of notes) console.log(`note: ${note}`);
for (const warning of warnings) console.log(`warn: ${warning}`);
for (const error of errors) console.log(`FAIL: ${error}`);

const largest = measured.reduce((max, file) => Math.max(max, file.lines), 0);
console.log(
  `file budget: ${measured.length} files, largest ${largest} lines, hard ${LIMITS.maxLines}, soft ${LIMITS.softLines}, exemptions ${grandfathered.length} (review due ${grandfathered[0]?.reviewBy ?? "unset"})`,
);

if (errors.length > 0) {
  console.error(`file budget check FAILED with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("file budget check passed.");
