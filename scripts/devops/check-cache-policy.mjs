#!/usr/bin/env node
/**
 * Check the Cloudflare edge cache payload against the cache policy contract
 * (BRAWUKA-834 / BRAWUKA-836 / BRAWUKA-837).
 *
 * Both files are GENERATED from one source — `web/config/app.yaml`
 * `seo.shellCache` via `web/lib/cache-policy.ts`
 * (`npm run gen:cache-rules`; BRAWUKA-821):
 *
 *   deploy/dokploy/cache-rules.json             the contract — declared
 *                                               bypass signals, TTLs, the
 *                                               sharedCacheAcrossLocales
 *                                               invariant
 *   deploy/dokploy/cloudflare-cache-rules.json  the deployable payload the
 *                                               zone runs
 *
 * The contract has no custom cache keys (unavailable on this zone's plan),
 * so its signals live under `bypass.*`. This script is the checked
 * relationship between the files: **the payload must implement every
 * declared bypass signal**, and extra strictness is fine.
 *
 * It also evaluates the payload's rules the way Cloudflare does — rules run
 * in order and the **last matching** action wins — for representative
 * requests, in both phases: a request-phase order that makes the
 * cache-eligible rule unreachable, or a response-phase rule that fails to
 * pin a Set-Cookie response no-store, fails here instead of in production
 * (BRAWUKA-836). All validation lives in `./lib/cache-policy-checks.mjs`;
 * the expression evaluator lives in `./lib/rules-language.mjs`. This file
 * is only the CLI — argument parsing and output formatting (BRAWUKA-839:
 * the checks outgrew the file cap, so the driver no longer owns them).
 *
 * The payload's declared phase names are checked too (BRAWUKA-837): the
 * applier builds the PUT URL from them, so a payload that names a different
 * phase would be uploaded to an entrypoint its rules were never checked
 * against.
 *
 * Usage:
 *   node scripts/devops/check-cache-policy.mjs [--payload <path>] [--contract <path>] [--json]
 *
 * Exit code 0 = the payload implements the contract and every representative
 * request gets the intended cache setting.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkCachePolicy } from "./lib/cache-policy-checks.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_CONTRACT = path.join(REPO_ROOT, "deploy/dokploy/cache-rules.json");
const DEFAULT_PAYLOAD = path.join(REPO_ROOT, "deploy/dokploy/cloudflare-cache-rules.json");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main(argv) {
  let contractPath = DEFAULT_CONTRACT;
  let payloadPath = DEFAULT_PAYLOAD;
  let asJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--contract") {
      contractPath = path.resolve(argv[(index += 1)]);
    } else if (arg === "--payload") {
      payloadPath = path.resolve(argv[(index += 1)]);
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: check-cache-policy.mjs [--contract <path>] [--payload <path>] [--json]\n",
      );
      return 0;
    } else {
      process.stderr.write(`unknown argument ${arg}\n`);
      return 2;
    }
  }

  const contract = readJson(contractPath);
  const payload = readJson(payloadPath);
  const { failures, outcomes, responseOutcomes } = checkCachePolicy(contract, payload);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: failures.length === 0, failures, outcomes, responseOutcomes }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`contract: ${path.relative(REPO_ROOT, contractPath)}\n`);
    process.stdout.write(`payload:  ${path.relative(REPO_ROOT, payloadPath)}\n\n`);
    for (const outcome of outcomes) {
      const verdict = outcome.actual === outcome.expected ? "ok  " : "FAIL";
      process.stdout.write(`${verdict} cache=${String(outcome.actual)} ${outcome.name}\n`);
    }
    for (const outcome of responseOutcomes) {
      const verdict = outcome.actual === outcome.expected ? "ok  " : "FAIL";
      process.stdout.write(
        `${verdict} no_store=${String(outcome.actual)} ${outcome.name}\n`,
      );
    }
    for (const failure of failures) {
      process.stdout.write(`\nFAIL ${failure}\n`);
    }
    process.stdout.write(
      failures.length === 0
        ? "\ncache policy check passed.\n"
        : `\ncache policy check FAILED (${failures.length}).\n`,
    );
  }

  return failures.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
