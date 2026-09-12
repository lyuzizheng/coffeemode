import { describe, expect, it } from "vitest";
import { DEPLOY_TARGETS, evaluateDeployConfig, main, parseArgs } from "../scripts/deploy.mjs";

// `main` is driven with an injected resolver: these tests cover the guard's own
// behaviour (which resolved configs are refused, and what the refused deploy
// path exits with) without invoking wrangler. `poi-service/wrangler.toml` has no
// `[env.*]` block yet (owner actions: docs/agent/pending-user-actions.md §7), so
// the configured shape is exercised through a fixture.

type Env = "staging" | "production";

const LOCAL_KV_ID = "22222222-2222-2222-2222-222222222222";
const LOCAL_D1_ID = "11111111-1111-1111-1111-111111111111";

function emptyConfig(env: Env) {
  return { name: `poi-service-${env === "production" ? "prod" : env}`, kv_namespaces: [], d1_databases: [] };
}

function placeholderConfig(env: Env) {
  return {
    name: `poi-service-${env === "production" ? "prod" : env}`,
    kv_namespaces: [{ binding: "POI_KV", id: LOCAL_KV_ID }],
    d1_databases: [{ binding: "POI_DB", database_name: DEPLOY_TARGETS[env].database, database_id: LOCAL_D1_ID }],
  };
}

function configuredConfig(env: Env) {
  return {
    name: DEPLOY_TARGETS[env].worker,
    kv_namespaces: [{ binding: "POI_KV", id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }],
    d1_databases: [
      { binding: "POI_DB", database_name: DEPLOY_TARGETS[env].database, database_id: "3c8d5b10-2f47-4e69-9c02-51ab7de8f334" },
    ],
  };
}

const NO_ENV_SECTION_FIXTURE = "tests/fixtures/wrangler.local-defaults.toml";
const PLACEHOLDER_IDS_FIXTURE = "tests/fixtures/wrangler.placeholder-ids-in-env.toml";
const CONFIGURED_FIXTURE = "tests/fixtures/wrangler.configured.toml";

async function runGuard(argv: string[], config: unknown) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    log: (...args: unknown[]) => out.push(args.join(" ")),
    logError: (...args: unknown[]) => err.push(args.join(" ")),
    resolve: async () => config,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("parseArgs", () => {
  it("reads --env/--check/--config and forwards everything else to wrangler", () => {
    expect(parseArgs(["--env", "staging", "--check", "--dry-run"])).toEqual({
      env: "staging",
      config: undefined,
      check: true,
      passthrough: ["--dry-run"],
    });
    expect(parseArgs(["--env=production"]).env).toBe("production");
  });
});

describe("evaluateDeployConfig", () => {
  it("accepts the configured staging and production targets", () => {
    for (const env of ["staging", "production"] as const) {
      expect(evaluateDeployConfig({ env, config: configuredConfig(env), hasEnvSection: true })).toEqual([]);
    }
  });

  it("flags the local-dev placeholder ids and the missing bindings", () => {
    const reasons = evaluateDeployConfig({
      env: "production",
      config: placeholderConfig("production"),
      hasEnvSection: true,
    }).join("\n");

    expect(reasons).toContain("POI_KV");
    expect(reasons).toContain("POI_DB");
    expect(reasons).toContain(LOCAL_KV_ID);
    expect(reasons).toContain(LOCAL_D1_ID);

    const empty = evaluateDeployConfig({ env: "production", config: emptyConfig("production"), hasEnvSection: true }).join("\n");
    expect(empty).toMatch(/no POI_KV binding/);
    expect(empty).toMatch(/no POI_DB binding/);
  });

  it("flags a missing [env.<name>] section, the shape a bare deploy resolves to", () => {
    const reasons = evaluateDeployConfig({
      env: "production",
      config: placeholderConfig("production"),
      hasEnvSection: false,
      configFile: "wrangler.toml",
    }).join("\n");

    expect(reasons).toMatch(/no \[env\.production\] section/);
  });

  it("flags a D1 database that is no longer the pinned per-environment database", () => {
    const config = configuredConfig("production");
    config.d1_databases[0].database_name = "poi-store-staging";

    expect(evaluateDeployConfig({ env: "production", config, hasEnvSection: true }).join("\n")).toMatch(
      /database_name is "poi-store-staging"/,
    );
  });

  it("flags a KV id in a shape Cloudflare does not accept", () => {
    // A dashed UUID is not a KV namespace id: the API rejects it (`could not
    // parse UUID from request's namespace_id ... invalid namespace format`), so
    // the guard must not wave it through.
    const config = configuredConfig("production");
    config.kv_namespaces[0].id = "9f1c4a2e-7b30-4d55-8a11-6c2d90f4e7b8";

    expect(evaluateDeployConfig({ env: "production", config, hasEnvSection: true }).join("\n")).toMatch(
      /POI_KV id .* is not a Cloudflare resource id/,
    );
  });
});

describe("deploy path", () => {
  it("refuses a deploy whose resolved config still carries local-dev placeholders", async () => {
    const { code, err } = await runGuard(
      ["--env", "production", "--config", PLACEHOLDER_IDS_FIXTURE],
      placeholderConfig("production"),
    );

    expect(code).toBe(1);
    expect(err).toContain(LOCAL_KV_ID);
    expect(err).toMatch(/Nothing was deployed/);
    expect(err).not.toMatch(/no \[env\.production\] section/);
  });

  it("refuses a deploy for an --env the config file does not declare", async () => {
    const { code, err } = await runGuard(
      ["--env", "production", "--config", NO_ENV_SECTION_FIXTURE],
      placeholderConfig("production"),
    );

    expect(code).toBe(1);
    expect(err).toMatch(/no \[env\.production\] section/);
  });

  it("refuses a bare deploy with no --env", async () => {
    const { code, err } = await runGuard([], placeholderConfig("production"));

    expect(code).toBe(2);
    expect(err).toContain("--env is required");
  });

  it("refuses an --env that is not a deploy target", async () => {
    const { code } = await runGuard(["--env", "preview"], placeholderConfig("production"));

    expect(code).toBe(2);
  });

  it("lets a configured production env through in --check mode", async () => {
    const { code, out } = await runGuard(
      ["--env", "production", "--check", "--config", CONFIGURED_FIXTURE],
      configuredConfig("production"),
    );

    expect(code).toBe(0);
    expect(out).toContain("poi-service-prod");
  });
});
