#!/usr/bin/env node
// Gate 1 — catalog parity: fails when the en/zh message catalogs drift apart
// (issue #75). next-intl renders raw key paths on MISSING_MESSAGE, so catalog
// parity is a hard gate: any asymmetric key fails CI before it can ship to the UI.
//
// Gate 2 — server copy: fails when the persistence layer (`web/lib/db/**`) bakes
// user-visible copy into a string literal (BRAWUKA-215). A hardcoded zh maintainer
// label lived in `lib/db/cafes/meta.ts`, reached the English UI verbatim, and was
// invisible to gate 1 (parity only compares catalog key sets). The data layer
// emits decidable markers; the UI renders the catalog copy. Comments are ignored —
// only string literals count.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

const DATA_LAYER_DIR = join(root, "lib", "db");
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Offending CJK string literals in one source file: `{ line, text }` per hit. */
function cjkLiterals(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const hits = [];
  const record = (node, text) => {
    if (!CJK.test(text)) return;
    hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
  };
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) record(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      record(node.head, node.head.text);
      for (const span of node.templateSpans) record(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const offenders = [];
const dataLayerFiles = listSourceFiles(DATA_LAYER_DIR);
for (const file of dataLayerFiles) {
  for (const hit of cjkLiterals(file)) {
    offenders.push(`${relative(root, file)}:${hit.line}: ${JSON.stringify(hit.text)}`);
  }
}

if (offenders.length > 0) {
  console.error(
    `\nserver data layer carries ${offenders.length} CJK string literal(s) — user-visible copy belongs in messages/*.json, the server emits a marker the UI translates:`,
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(
  `server data layer copy-free: ${dataLayerFiles.length} files under lib/db scanned, 0 CJK literals.`,
);
