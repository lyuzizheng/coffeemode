#!/usr/bin/env node
/**
 * Guarded deploy entrypoint for the image-service Worker.
 *
 * Why this exists: the top-level `[vars]` in `wrangler.toml` are the local-dev
 * kit defaults (`R2_ACCOUNT_ID = "local"`, `R2_ENDPOINT = "http://localhost:9000"`).
 * A plain `wrangler deploy` ships exactly those values into the deployed Worker,
 * and `wrangler deploy --env <name>` for an environment that is not declared in
 * `wrangler.toml` falls back to the same top-level config with nothing but a
 * warning. Either way every presigned upload URL and HEAD check then targets
 * MinIO-on-localhost: 100% broken in production, with no deploy-time error.
 * The guard refuses both paths before wrangler is invoked.
 *
 * Usage:
 *   npm run deploy -- --env staging
 *   npm run deploy -- --env production
 *   node scripts/deploy.mjs --env production --check   # validate only, never deploy
 *
 * Extra arguments are forwarded to `wrangler deploy` (e.g. `--dry-run`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_FILE = "wrangler.toml";

/**
 * Canonical per-environment deploy targets (spec 0005 §3, plus the
 * `R2_PUBLIC_HOST` invariant in `web/lib/images/constants.ts`).
 *
 * Pinned on purpose: a renamed Worker, bucket, or CDN host must be a deliberate
 * edit here rather than a silent drift that only shows up as broken image URLs.
 */
export const DEPLOY_TARGETS = {
  staging: {
    worker: "image-service-staging",
    bucket: "coffeemode-images-staging",
    publicUrl: "https://staging-images.coffeemode.app",
  },
  production: {
    worker: "image-service-prod",
    bucket: "coffeemode-images-prod",
    publicUrl: "https://images.coffeemode.app",
  },
};

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** Hosts that only ever exist on a developer machine or in docker compose. */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "minio",
  "host.docker.internal",
]);

const USAGE = `usage: node scripts/deploy.mjs --env <${Object.keys(DEPLOY_TARGETS).join("|")}> [--check] [--config <file>] [wrangler args]

  --env <name>     required; selects the [env.<name>] block to deploy
  --check          validate the resolved config and exit without deploying
  --config <file>  wrangler config to read (default: ${DEFAULT_CONFIG_FILE})`;

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

/** Reason a URL is unusable outside local dev, or null when it is acceptable. */
function devOnlyUrlReason(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "not an absolute URL";
  }
  if (parsed.protocol !== "https:") {
    return `uses scheme "${parsed.protocol}" instead of https`;
  }
  if (LOCAL_HOSTS.has(parsed.hostname)) {
    return `host "${parsed.hostname}" is a local-dev host`;
  }
  return null;
}

/**
 * Every reason `image-service-prod`/`-staging` must not be deployed with the
 * resolved config. Empty array means the config is deployable.
 */
export function evaluateDeployConfig({ env, config, hasEnvSection, configFile = DEFAULT_CONFIG_FILE }) {
  const target = DEPLOY_TARGETS[env];
  const violations = [];

  if (!hasEnvSection) {
    violations.push(
      `${configFile} declares no [env.${env}] section — wrangler resolves the top-level ` +
        `local-dev [vars] instead (warning only), which is what would be deployed.`,
    );
  }

  if (config.name !== target.worker) {
    violations.push(
      `deploy target worker is ${JSON.stringify(config.name)} — expected ${JSON.stringify(target.worker)} (spec 0005 §3).`,
    );
  }

  const vars = config.vars ?? {};

  const accountId = String(vars.R2_ACCOUNT_ID ?? "");
  if (!ACCOUNT_ID.test(accountId)) {
    violations.push(
      `R2_ACCOUNT_ID is ${JSON.stringify(accountId)} — expected the 32-hex Cloudflare account id; ` +
        `presigned URLs are signed against https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com, ` +
        `so "local" (the local-dev value) signs them against nothing.`,
    );
  }

  const bucket = String(vars.R2_BUCKET_NAME ?? "");
  if (bucket !== target.bucket) {
    violations.push(
      `R2_BUCKET_NAME is ${JSON.stringify(bucket)} — expected ${JSON.stringify(target.bucket)} (spec 0005 §3).`,
    );
  }

  const publicUrl = String(vars.R2_PUBLIC_URL ?? "");
  const publicUrlReason = publicUrl === "" ? "is missing" : devOnlyUrlReason(publicUrl);
  if (publicUrlReason) {
    violations.push(`R2_PUBLIC_URL is ${JSON.stringify(publicUrl)} — ${publicUrlReason}.`);
  } else if (stripTrailingSlash(publicUrl) !== target.publicUrl) {
    violations.push(
      `R2_PUBLIC_URL is ${JSON.stringify(publicUrl)} — expected ${JSON.stringify(target.publicUrl)}; ` +
        `it must match R2_PUBLIC_HOST in web/lib/images/constants.ts.`,
    );
  }

  const endpoint = String(vars.R2_ENDPOINT ?? "");
  if (endpoint !== "") {
    const reason = devOnlyUrlReason(endpoint);
    if (reason) {
      violations.push(
        `R2_ENDPOINT is ${JSON.stringify(endpoint)} — ${reason}; a deployed Worker must sign against ` +
          `the real R2 endpoint derived from R2_ACCOUNT_ID, so leave R2_ENDPOINT empty.`,
      );
    }
  }

  for (const binding of config.r2_buckets ?? []) {
    if (binding.bucket_name !== target.bucket) {
      violations.push(
        `R2_BUCKET binding bucket_name is ${JSON.stringify(binding.bucket_name)} — expected ${JSON.stringify(target.bucket)} (spec 0005 §3).`,
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
    logError(`error: --env is required — a bare \`wrangler deploy\` ships the local-dev [vars].\n\n${USAGE}`);
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
        `Nothing was deployed. Fix the [env.${env}] block in ${configFile} (see image-service/README.md → Deploy), then re-run.`,
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
