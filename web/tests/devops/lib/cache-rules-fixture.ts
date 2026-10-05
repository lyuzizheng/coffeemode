import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";

// BRAWUKA-834: deploy/dokploy/cache-rules.json is the policy contract, but
// nothing applied it to the edge — the 2026-10-05 staging locale bug survived a
// contract-only change. scripts/devops/apply-cache-rules.sh applies the
// effective ruleset (deploy/dokploy/cloudflare-cache-rules.json) through the
// Cloudflare Rulesets API, and scripts/devops/check-cache-policy.mjs is the
// checked relationship between the two files. Every case runs a byte-identical
// copy of the sources inside a scratch tree with a stub `curl` first on PATH,
// so the assertions are about the payload the script would send and how it
// exits — never about the live zone.
//
// The fixture backs apply-cache-rules.test.ts (the applier suite); the
// generated artifacts themselves are pinned by cache-rules-drift.test.ts.

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const SCRATCH_ROOT = "repo";
export const SCRIPT = `${SCRATCH_ROOT}/scripts/devops/apply-cache-rules.sh`;
export const CHECKER = `${SCRATCH_ROOT}/scripts/devops/check-cache-policy.mjs`;
export const RULES = `${SCRATCH_ROOT}/deploy/dokploy/cloudflare-cache-rules.json`;
export const CONTRACT = `${SCRATCH_ROOT}/deploy/dokploy/cache-rules.json`;
const SOURCES = [
  "scripts/devops/apply-cache-rules.sh",
  "scripts/devops/check-cache-policy.mjs",
  "scripts/devops/lib/rules-language.mjs",
  "scripts/devops/lib/cache-policy-checks.mjs",
  "scripts/devops/lib/cache-policy-coverage.mjs",
  "deploy/dokploy/cloudflare-cache-rules.json",
  "deploy/dokploy/cache-rules.json",
  "web/i18n/request.ts",
];
export const STAGING_HOST = "staging.cafemood.app";

export type CacheRule = {
  expression: string;
  enabled?: boolean;
  action_parameters: { cache: boolean };
};

export function isCacheRule(value: unknown): value is CacheRule {
  if (typeof value !== "object" || value === null) return false;
  if (!("expression" in value) || typeof value.expression !== "string") return false;
  if (!("action_parameters" in value)) return false;
  const params = value.action_parameters;
  return (
    typeof params === "object" &&
    params !== null &&
    "cache" in params &&
    typeof params.cache === "boolean"
  );
}

export type RulesFile = {
  $note: string;
  request: { phase: string; description?: string; rules: unknown[] };
  response?: { phase: string; description?: string; rules: unknown[] };
};

export function isRulesFile(value: unknown): value is RulesFile {
  if (typeof value !== "object" || value === null) return false;
  if (!("$note" in value) || typeof value.$note !== "string") return false;
  if (!("request" in value)) return false;
  const request = value.request;
  return (
    typeof request === "object" &&
    request !== null &&
    "phase" in request &&
    typeof request.phase === "string" &&
    "rules" in request &&
    Array.isArray(request.rules)
  );
}

let tmpRoot = "";
let binDir = "";
let curlLog = "";
let responseFile = "";

/** Paths inside the scratch tree, filled by setupScratchTree(). */
export const scratch = { root: "", curlLog: "", responseFile: "" };

const SUCCESS_RESPONSE = JSON.stringify({
  success: true,
  result: { version: 7, rules: [{}, {}, {}, {}] },
});

/** Copy the sources into a scratch tree and install the stub `curl`. */
export function setupScratchTree() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-cache-rules-"));
  for (const rel of SOURCES) {
    const target = path.join(tmpRoot, SCRATCH_ROOT, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), target);
  }
  binDir = path.join(tmpRoot, "bin");
  fs.mkdirSync(binDir);
  curlLog = path.join(tmpRoot, "curl.log");
  fs.writeFileSync(curlLog, "");
  responseFile = path.join(tmpRoot, "response.json");
  fs.writeFileSync(responseFile, SUCCESS_RESPONSE);
  scratch.root = tmpRoot;
  scratch.curlLog = curlLog;
  scratch.responseFile = responseFile;
  // Stub curl: records argv and prints the canned response file. A case can
  // point CURL_STUB_RESPONSE_FILE at its own file to simulate a rejection.
  fs.writeFileSync(
    path.join(binDir, "curl"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${curlLog}"\ncat "\${CURL_STUB_RESPONSE_FILE:-${responseFile}}"\n`,
    { mode: 0o755 },
  );
}

export function teardownScratchTree() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

/** Run the scratch copy with a hermetic credential set and the stub curl first. */
export function run(args: string[], env: Record<string, string> = {}) {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
  };
  delete base.CLOUDFLARE_API_TOKEN;
  delete base.CLOUDFLARE_ZONE_ID;
  const result = spawnSync("bash", [path.join(tmpRoot, SCRIPT), ...args], {
    env: { ...base, ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The request-phase payload a dry run prints, parsed back into an object. */
export function dryRunPayload(): unknown {
  const { status, stdout } = run(["--dry-run", "--phase", "request"]);
  expect(status).toBe(0);
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
}

/** Write a mutated copy of the committed payload and return its path. */
export function mutatedPayload(mutate: (payload: RulesFile) => void): string {
  const payload: unknown = JSON.parse(fs.readFileSync(path.join(tmpRoot, RULES), "utf8"));
  if (!isRulesFile(payload)) throw new Error("committed payload is not a rules file");
  mutate(payload);
  const file = path.join(tmpRoot, `payload-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

