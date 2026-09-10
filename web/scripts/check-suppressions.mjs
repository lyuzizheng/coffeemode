#!/usr/bin/env node
/**
 * Suppression ratchet — the fourth `npm run check:structure` check (spec 0009).
 *
 * The rule-level registry is `web/eslint-suppressions.json` (ESLint bulk
 * suppressions). Nothing in ESLint stops a developer or an agent from running
 * `npx eslint --suppress-all` and committing the result: ESLint then reports no
 * violation, `npm run lint` passes, and the structural rules quietly stop
 * applying to that code. Three assertions close that path:
 *
 *   1. Budget ratchet — `structure-baseline.json.eslintSuppressions` records the
 *      registry size (files / entries / per-rule violation totals). Any growth
 *      fails; shrinkage passes with a prompt to lower the budget, so granting an
 *      exemption always shows up as a committed diff of two files.
 *   2. Stale exemptions — ESLint is re-run against a committed empty registry
 *      (`scripts/empty-suppressions.json`) to get the full violation inventory.
 *      A registered file+rule with no remaining violation must be deleted, so the
 *      registry cannot stay fat after the code improves.
 *   3. max-lines parity — files carrying a `max-lines` suppression must be exactly
 *      the files in `structure-baseline.json.files`, so a rule-level suppression
 *      can never bypass the file-size ratchet.
 *
 * The budget also carries `reviewBy`: spec 0009 §7.1 forbids merging an exemption
 * without an expiry date, and §7.3 requires a quarterly review, so an overdue date
 * fails the gate instead of living only in prose.
 *
 * Prints `suppressed violations: N (budget M)` so the frozen debt is visible in
 * every CI log. `--print-budget` prints the `eslintSuppressions` block for the
 * current tree (reviewed by hand; never auto-written).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_SUPPRESSIONS_FILE,
  STRUCTURAL_RULE_IDS,
  SUPPRESSIONS_FILE,
  loadBaseline,
} from "../structure.config.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const printBudget = process.argv.includes("--print-budget");

const registry = JSON.parse(readFileSync(join(webRoot, SUPPRESSIONS_FILE), "utf8"));
const baseline = loadBaseline();
const budget = baseline.eslintSuppressions;
const baselineFiles = baseline.files.map((entry) => entry.path);
function summarize(entries) {
  const perRule = {};
  let files = 0;
  let violations = 0;
  for (const rules of Object.values(entries)) {
    files += 1;
    for (const [rule, { count }] of Object.entries(rules)) {
      perRule[rule] = (perRule[rule] ?? 0) + count;
      violations += count;
    }
  }
  const entryCount = Object.values(entries).reduce(
    (total, rules) => total + Object.keys(rules).length,
    0,
  );
  return { files, entries: entryCount, violations, perRule };
}

const current = summarize(registry);
const budgetViolations = budget?.perRule
  ? Object.values(budget.perRule).reduce((total, count) => total + count, 0)
  : 0;

if (!budget && !printBudget) {
  console.error(
    "structure-baseline.json has no `eslintSuppressions` budget — seed it with `node scripts/check-suppressions.mjs --print-budget`.",
  );
  process.exit(1);
}

if (printBudget) {
  process.stdout.write(
    `${JSON.stringify(
      {
        files: current.files,
        entries: current.entries,
        perRule: Object.fromEntries(
          Object.entries(current.perRule).sort(([a], [b]) => a.localeCompare(b)),
        ),
        ...(budget?.reviewBy ? { reviewBy: budget.reviewBy } : {}),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

/** Full violation inventory: ESLint with an empty registry, structural rules only. */
async function fullInventory() {
  return new Promise((resolve) => {
    const child = spawn(
      join(webRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint"),
      ["--format", "json", "--suppressions-location", EMPTY_SUPPRESSIONS_FILE],
      { cwd: webRoot, env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ error: error.message }));
    child.on("close", () => {
      try {
        resolve({ report: JSON.parse(stdout || "[]") });
      } catch {
        resolve({ error: `eslint did not return JSON: ${stderr.trim() || stdout.trim()}` });
      }
    });
  });
}

const inventory = await fullInventory();
if (inventory.error) {
  console.error(`suppression ratchet cannot read the violation inventory — ${inventory.error}`);
  process.exit(1);
}

/** file (web-relative) -> rule -> live violation count, structural rules only. */
const live = {};
for (const file of inventory.report) {
  const path = relative(webRoot, file.filePath);
  for (const message of file.messages) {
    if (message.severity !== 2) continue;
    if (!message.ruleId || !STRUCTURAL_RULE_IDS.includes(message.ruleId)) continue;
    live[path] ??= {};
    live[path][message.ruleId] = (live[path][message.ruleId] ?? 0) + 1;
  }
}

const errors = [];
const notes = [];

// 1. Budget ratchet — growth fails, shrinkage asks for a tighter budget.
const budgetRule = (rule) => budget.perRule[rule] ?? 0;
// spec 0009 §7.1: an exemption without a review date must not be mergeable.
if (!budget.reviewBy || Number.isNaN(Date.parse(budget.reviewBy))) {
  errors.push("eslintSuppressions.reviewBy is missing or not a date — spec 0009 §7.1 requires an expiry date for rule-level exemptions");
} else if (Date.parse(budget.reviewBy) < Date.now()) {
  errors.push(`rule-level exemption review was due ${budget.reviewBy} (spec 0009 §7.3) — split the code, renew with a new date, or open a P1 debt issue`);
}
if (current.files > budget.files) {
  errors.push(
    `registry covers ${current.files} files, budget ${budget.files} — a new rule-level exemption must be approved and the budget raised in the same commit`,
  );
}
if (current.entries > budget.entries) {
  errors.push(
    `registry holds ${current.entries} file+rule entries, budget ${budget.entries} — growing the registry silently re-opens the gate`,
  );
}
for (const [rule, count] of Object.entries(current.perRule)) {
  if (count > budgetRule(rule)) {
    errors.push(`${rule}: ${count} suppressed violations, budget ${budgetRule(rule)} — fix the code instead of adding an exemption`);
  } else if (count < budgetRule(rule)) {
    notes.push(`${rule}: ${count} suppressed, budget ${budgetRule(rule)} — lower the budget`);
  }
}
for (const rule of Object.keys(budget.perRule)) {
  if (!(rule in current.perRule)) {
    notes.push(`${rule}: no suppressed violations left — drop it from the budget`);
  }
}
if (current.files < budget.files || current.entries < budget.entries) {
  notes.push(
    `registry shrank to ${current.files} files / ${current.entries} entries (budget ${budget.files}/${budget.entries}) — lower the budget in this commit`,
  );
}

// 2. Stale exemptions — every registered entry must still violate something.
for (const [path, rules] of Object.entries(registry)) {
  for (const [rule, { count }] of Object.entries(rules)) {
    const actual = live[path]?.[rule] ?? 0;
    if (actual === 0) {
      const where = existsSync(join(webRoot, path)) ? "no longer violates" : "file is gone";
      errors.push(
        `${path}: exemption for ${rule} is stale (${where} it) — delete the entry (\`npx eslint --prune-suppressions\`) and lower the budget`,
      );
    } else if (actual < count) {
      notes.push(`${path}: registry records ${count} ${rule} violations, code now has ${actual} — prune the surplus`);
    }
  }
}

// 3. max-lines parity — file-size exemptions must be exactly the sized baseline.
const suppressedMaxLines = Object.entries(registry)
  .filter(([, rules]) => rules["max-lines"])
  .map(([path]) => path)
  .sort();
const expected = [...baselineFiles].sort();
for (const path of suppressedMaxLines) {
  if (!expected.includes(path)) {
    errors.push(
      `${path}: max-lines exemption without a structure-baseline.json size entry — register the file (with its line count) instead of suppressing the rule`,
    );
  }
}
for (const path of expected) {
  if (!suppressedMaxLines.includes(path)) {
    errors.push(
      `${path}: structure-baseline.json size entry without a max-lines exemption — ESLint would report the file; split it or fix the registry`,
    );
  }
}

for (const note of notes) console.log(`note: ${note}`);
for (const error of errors) console.log(`FAIL: ${error}`);
console.log(
  `suppressed violations: ${current.violations} (budget ${budgetViolations}) across ${current.files} files / ${current.entries} entries; review due ${budget.reviewBy ?? "unset"}`,
);
const liveTotal = Object.values(live).reduce(
  (total, rules) => total + Object.values(rules).reduce((a, b) => a + b, 0),
  0,
);
console.log(`live structural violations: ${liveTotal} (full inventory, suppressions ignored)`);

if (errors.length > 0) {
  console.error(`suppression ratchet FAILED with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("suppression ratchet passed.");
