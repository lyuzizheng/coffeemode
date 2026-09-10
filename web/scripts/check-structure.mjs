#!/usr/bin/env node
/**
 * Unified structure gate (spec 0009).
 *
 * Runs the four structure checks in parallel and fails if any of them fails:
 *   - ESLint structural rules (file/function budget, nesting, complexity,
 *     identical functions, layer boundaries), reporting only the rule ids owned
 *     by this guard — everything else stays `npm run lint`'s job. ESLint's
 *     suppressions file (`web/eslint-suppressions.json`) carries the
 *     pre-existing violations, so this pass reports new code only.
 *   - suppression ratchet: the registry above may only shrink, stale exemptions
 *     must be pruned, and `max-lines` exemptions must match the size baseline.
 *   - jscpd duplication budget (`.jscpd.json` at the repo root).
 *   - `scripts/check-file-size.mjs` file budget + grandfathered ratchet.
 *
 * Thresholds come from `structure.config.mjs`: one number, one owner.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS, STRUCTURAL_RULE_IDS } from "../structure.config.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

const bin = (name) =>
  join(webRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

function exec(name, command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ name, ok: false, stdout: "", stderr: error.message }));
    child.on("close", (code) => resolve({ name, ok: code === 0, stdout, stderr }));
  });
}

const output = (result) => [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

/** ESLint pass, filtered to the structural rule ids this guard owns. */
async function eslintStructure() {
  const result = await exec("eslint (structural rules)", bin("eslint"), ["--format", "json"], webRoot);
  let report;
  try {
    report = JSON.parse(result.stdout || "[]");
  } catch {
    return {
      name: result.name,
      ok: false,
      detail: `eslint did not return JSON — run \`npm run lint\` for the raw output.\n${output(result)}`,
    };
  }
  const findings = [];
  for (const file of report) {
    for (const message of file.messages) {
      const structural = message.ruleId === null || STRUCTURAL_RULE_IDS.includes(message.ruleId);
      if (message.severity !== 2 || !structural) continue;
      findings.push(
        `${relative(webRoot, file.filePath)}:${message.line}:${message.column} ${message.ruleId ?? "fatal"} — ${message.message}`,
      );
    }
  }
  return { name: result.name, ok: findings.length === 0, detail: findings.join("\n") };
}

async function suppressionRatchet() {
  const result = await exec(
    "suppression ratchet",
    process.execPath,
    [join("scripts", "check-suppressions.mjs")],
    webRoot,
  );
  return { name: result.name, ok: result.ok, detail: output(result) };
}

async function duplicationBudget() {
  // `.jscpd.json` must mirror `LIMITS.duplication`: jscpd reads JSON, this guard
  // reads the module, and a silent drift between them would weaken the gate.
  const configPath = join(webRoot, "..", ".jscpd.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const drift = ["threshold", "minLines", "minTokens"].filter(
    (key) => config[key] !== LIMITS.duplication[key],
  );
  if (drift.length > 0) {
    const detail = drift
      .map((key) => `.jscpd.json ${key}=${config[key]} but structure.config.mjs LIMITS.duplication.${key}=${LIMITS.duplication[key]}`)
      .join("\n");
    return { name: "duplication (jscpd)", ok: false, detail: `duplication budget drifted:\n${detail}` };
  }
  const result = await exec("duplication (jscpd)", bin("jscpd"), ["--config", "../.jscpd.json"], webRoot);
  return { name: result.name, ok: result.ok, detail: output(result) };
}

async function fileBudget() {
  const result = await exec("file budget + ratchet", process.execPath, [join("scripts", "check-file-size.mjs")], webRoot);
  return { name: result.name, ok: result.ok, detail: output(result) };
}

const checks = await Promise.all([
  eslintStructure(),
  suppressionRatchet(),
  duplicationBudget(),
  fileBudget(),
]);

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`\n=== ${check.ok ? "PASS" : "FAIL"} ${check.name} ===`);
  if (check.detail) console.log(check.detail);
}

console.log("");
if (failed > 0) {
  console.error(
    `structure guard FAILED (${failed}/${checks.length} checks). Thresholds: web/structure.config.mjs; policy: docs/specs/0009.`,
  );
  process.exit(1);
}
console.log(`structure guard passed (${checks.length}/${checks.length} checks).`);
