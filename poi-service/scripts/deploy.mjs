#!/usr/bin/env node
/**
 * Guarded deploy entrypoint for the poi-service Worker.
 *
 * Why this exists: `wrangler.toml` ships deterministic local-dev placeholder
 * bindings (`POI_KV` = `22222222-…`, `POI_DB` = `11111111-…`) so the compose
 * PoI stack works without an account, and it declares no `[env.*]` blocks. A
 * bare `wrangler deploy` therefore deploys those placeholders (and an
 * `--env <name>` for an undeclared environment falls back to them with a
 * warning only), producing a Worker whose cache and D1 store are not the real
 * resources. The guard refuses that before wrangler is invoked, and it names
 * the resources to create.
 *
 * Usage:
 *   npm run deploy -- --env staging
 *   npm run deploy -- --env production
 *   node scripts/deploy.mjs --env production --check   # validate only, never deploy
 *
 * Extra arguments are forwarded to `wrangler deploy`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_FILE = "wrangler.toml";
const SETUP_DOC = "docs/agent/pending-user-actions.md §7";

/**
 * Canonical per-environment deploy targets (spec 0005 §3).
 *
 * Pinned on purpose: a renamed Worker or D1 database must be a deliberate edit
 * here rather than a silent drift that deploys a half-configured Worker.
 */
export const DEPLOY_TARGETS = {
  staging: {
    worker: "poi-service-staging",
    database: "poi-store-staging",
    kvCreate: "poi-cache-staging",
  },
  production: {
    worker: "poi-service-prod",
    database: "poi-store",
    kvCreate: "poi-cache",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `11111111-…` / `22222222-…`: the deterministic local-dev placeholder ids. */
const PLACEHOLDER_ID = /^([0-9a-f])\1{7}-/;

const USAGE = `usage: node scripts/deploy.mjs --env <${Object.keys(DEPLOY_TARGETS).join("|")}> [--check] [--config <file>] [wrangler args]

  --env <name>     required; selects the [env.<name>] block to deploy
  --check          validate the resolved config and exit without deploying
  --config <file>  wrangler config to read (default: ${DEFAULT_CONFIG_FILE})`;

/** Reason an id is not a real Cloudflare resource id, or null when it is. */
function idProblem(id) {
  if (id === "") {
    return "is empty";
  }
  if (id === "local") {
    return "is the local-dev placeholder";
  }
  if (!UUID.test(id)) {
    return "is not a Cloudflare resource id (expected a UUID)";
  }
  if (PLACEHOLDER_ID.test(id)) {
    return "is the deterministic local-dev placeholder id, not a real resource";
  }
  return null;
}

/**
 * Every reason `poi-service-prod`/`-staging` must not be deployed with the
 * resolved config. Empty array means the config is deployable.
 */
export function evaluateDeployConfig({ env, config, hasEnvSection, configFile = DEFAULT_CONFIG_FILE }) {
  const target = DEPLOY_TARGETS[env];
  const violations = [];

  if (!hasEnvSection) {
    violations.push(
      `${configFile} declares no [env.${env}] section — wrangler resolves the top-level ` +
        `local-dev bindings instead (warning only), which is what would be deployed.`,
    );
  }

  if (config.name !== target.worker) {
    violations.push(
      `deploy target worker is ${JSON.stringify(config.name)} — expected ${JSON.stringify(target.worker)} (spec 0005 §3).`,
    );
  }

  const kv = (config.kv_namespaces ?? []).find((binding) => binding.binding === "POI_KV");
  if (!kv) {
    violations.push(
      `no POI_KV binding — the deployed Worker would have no Google Places cache. Add the ` +
        `KV namespace created by \`wrangler kv namespace create ${target.kvCreate}\` (${SETUP_DOC}).`,
    );
  } else {
    const problem = idProblem(String(kv.id ?? ""));
    if (problem) {
      violations.push(
        `POI_KV id ${JSON.stringify(kv.id)} ${problem}; paste the id returned by ` +
          `\`wrangler kv namespace create ${target.kvCreate}\` (${SETUP_DOC}).`,
      );
    }
  }

  const db = (config.d1_databases ?? []).find((binding) => binding.binding === "POI_DB");
  if (!db) {
    violations.push(
      `no POI_DB binding — the deployed Worker would have no POI store. Add the D1 database ` +
        `created by \`wrangler d1 create ${target.database}\` (${SETUP_DOC}).`,
    );
  } else {
    const problem = idProblem(String(db.database_id ?? ""));
    if (problem) {
      violations.push(
        `POI_DB database_id ${JSON.stringify(db.database_id)} ${problem}; paste the id returned by ` +
          `\`wrangler d1 create ${target.database}\` (${SETUP_DOC}).`,
      );
    }
    if (db.database_name !== target.database) {
      violations.push(
        `POI_DB database_name is ${JSON.stringify(db.database_name)} — expected ${JSON.stringify(target.database)} (spec 0005 §3).`,
      );
    }
  }

  return violations;
}

/** True when `configFile` declares `[env.<env>]` (wrangler does not tell us). */
export function hasEnvSection(configFile, env) {
  let source;
  try {
    source = readFileSync(configFile, "utf8");
  } catch {
    return false;
  }
  const escaped = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*\\[\\s*env\\.${escaped}\\s*\\]`, "m").test(source);
}

export function parseArgs(argv) {
  const parsed = { env: undefined, config: undefined, check: false, passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    if (flag === "--env") {
      parsed.env = inline ?? argv[(i += 1)];
    } else if (flag === "--config" || flag === "-c") {
      parsed.config = inline ?? argv[(i += 1)];
    } else if (flag === "--check") {
      parsed.check = true;
    } else {
      parsed.passthrough.push(arg);
    }
  }
  return parsed;
}

async function readWranglerConfig(configFile, env) {
  const { unstable_readConfig } = await import("wrangler");
  return unstable_readConfig({ config: configFile, env });
}

function runWranglerDeploy({ env, config, passthrough }) {
  const require = createRequire(import.meta.url);
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const args = [wranglerBin, "deploy", "--env", env];
  if (config) {
    args.push("--config", config);
  }
  args.push(...passthrough);

  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`error: could not run wrangler: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Validate the resolved config for `env`, then deploy unless `--check` was
 * passed. Returns the process exit code: 0 deployed/valid, 1 refused, 2 usage.
 *
 * `resolve` is injectable so tests can drive the guard with synthetic configs
 * without paying for wrangler's config resolution (or risking a real deploy).
 */
export async function main(
  argv,
  { log = console.log, logError = console.error, resolve = readWranglerConfig } = {},
) {
  const { env, config, check, passthrough } = parseArgs(argv);

  if (!env) {
    logError(`error: --env is required — a bare \`wrangler deploy\` ships the local-dev bindings.\n\n${USAGE}`);
    return 2;
  }
  if (!Object.hasOwn(DEPLOY_TARGETS, env)) {
    logError(
      `error: unknown --env ${JSON.stringify(env)}; expected one of ${Object.keys(DEPLOY_TARGETS).join(", ")}.\n\n${USAGE}`,
    );
    return 2;
  }

  const configFile = config ?? DEFAULT_CONFIG_FILE;
  let resolved;
  try {
    resolved = await resolve(configFile, env);
  } catch (error) {
    logError(`error: could not read ${configFile} for --env ${env}: ${String(error?.message ?? error).split("\n")[0]}`);
    return 2;
  }

  const violations = evaluateDeployConfig({
    env,
    config: resolved,
    hasEnvSection: hasEnvSection(configFile, env),
    configFile,
  });
  if (violations.length > 0) {
    logError(
      [
        `REFUSING to deploy ${resolved.name} (--env ${env}): the resolved ${configFile} is not deployable.`,
        ...violations.map((violation) => `  - ${violation}`),
        "",
        `Nothing was deployed. Fix the [env.${env}] block in ${configFile} (see poi-service/README.md → Deploy checklist), then re-run.`,
      ].join("\n"),
    );
    return 1;
  }

  if (check) {
    log(`ok: --env ${env} resolves to a deployable ${configFile} (worker ${resolved.name}); nothing deployed (--check).`);
    return 0;
  }

  return runWranglerDeploy({ env, config, passthrough });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`error: ${error?.message ?? error}`);
      process.exitCode = 1;
    },
  );
}
