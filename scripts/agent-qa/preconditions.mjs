#!/usr/bin/env node
/**
 * Agent-QA precondition evaluator (BRAWUKA-955).
 *
 * `planRound(satisfied)` (journeys.mjs) gates journeys on precondition names,
 * but until this module existed no deterministic script produced that set: the
 * QA agent inferred it each round from prose, and after the key rename
 * (BRAWUKA-950) it kept applying the retired variable names — so a resolvable
 * staging Supabase triple still read as `blocked (supabase-keys missing)`.
 *
 * The run contract is now: execute this script, pass its `satisfied` array to
 * `planRound` verbatim. Never infer a precondition from memory or from a
 * previous round.
 *
 *   node scripts/agent-qa/preconditions.mjs
 *   {"satisfied":["access-token","supabase-keys"],"missing":[],"unverified":[...],...}
 *
 * Three buckets, never mixed:
 *
 *   satisfied   the env contract resolves — the precondition holds
 *   missing     the env contract does not resolve; `missingVariables` names
 *               the exact variable(s) at fault (names only, never a value)
 *   unverified  the precondition has no env contract (a live probe or a
 *               provisioned persona decides it); it is NOT satisfied and the
 *               registry's `check` text is the only authority on it
 *
 * Names come from the journey registry, so attaching a new precondition to a
 * journey cannot leave it out of this report. Resolution reuses the same
 * resolvers the runner uses (`supabase-env.mjs` fallback chain included: new
 * key names first, legacy names accepted while deployments migrate).
 *
 * Usage:
 *   node scripts/agent-qa/preconditions.mjs [--help]
 *
 * Exit code 0 = evaluation ran (missing/unverified are data, not an error);
 * 2 = usage error. Output never contains a secret value.
 */

import { pathToFileURL } from "node:url";

import { accessEnvMissing } from "./access-headers.mjs";
import { AGENT_QA_JOURNEYS } from "./journeys.mjs";
import { supabaseEnvMissing } from "./supabase-env.mjs";

/** @typedef {"satisfied" | "missing" | "unverified"} PreconditionState */

/**
 * Precondition name → the env gaps that name it missing. A name absent from
 * this map has no env contract and reports as `unverified`.
 *
 * @type {ReadonlyMap<string, (env: Record<string, string | undefined>) => string[]>}
 */
const ENV_CONTRACTS = new Map([
  ["access-token", accessEnvMissing],
  ["supabase-keys", supabaseEnvMissing],
]);

/**
 * Every precondition any registered journey declares, first-seen order.
 *
 * @type {readonly string[]}
 */
export const AGENT_QA_PRECONDITION_NAMES = Object.freeze([
  ...new Set(
    AGENT_QA_JOURNEYS.flatMap((journey) => journey.preconditions.map((precondition) => precondition.name)),
  ),
]);

/**
 * Evaluate every registry precondition against one env source.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @returns {{
 *   satisfied: string[],
 *   missing: string[],
 *   unverified: string[],
 *   missingVariables: Record<string, string[]>,
 * }}
 */
export function evaluateAgentQaPreconditions(env = process.env) {
  /** @type {string[]} */
  const satisfied = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const unverified = [];
  /** @type {Record<string, string[]>} */
  const missingVariables = {};
  for (const name of AGENT_QA_PRECONDITION_NAMES) {
    const readGaps = ENV_CONTRACTS.get(name);
    if (!readGaps) {
      unverified.push(name);
      continue;
    }
    const gaps = readGaps(env);
    if (gaps.length === 0) {
      satisfied.push(name);
    } else {
      missing.push(name);
      missingVariables[name] = gaps;
    }
  }
  return { satisfied, missing, unverified, missingVariables };
}

const USAGE = `Usage: node scripts/agent-qa/preconditions.mjs [--help]

Print the deterministic agent-QA precondition set as JSON:
  satisfied   env-resolved preconditions — pass this array to planRound()
  missing     env contracts that do not resolve; missingVariables names each gap
  unverified  preconditions with no env contract (live probe / provisioned persona)

Exit code 0 = evaluation ran; 2 = usage error. No secret value is ever printed.`;

/**
 * CLI entry point.
 *
 * @param {string[]} argv arguments after the script path
 * @param {Record<string, string | undefined>} [env] env source
 * @returns {number} process exit code
 */
export function main(argv, env = process.env) {
  if (argv.length > 0) {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    process.stderr.write(`Unknown argument: ${argv[0]}\n\n${USAGE}\n`);
    return 2;
  }
  process.stdout.write(`${JSON.stringify(evaluateAgentQaPreconditions(env), null, 2)}\n`);
  return 0;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  process.exitCode = main(process.argv.slice(2));
}
