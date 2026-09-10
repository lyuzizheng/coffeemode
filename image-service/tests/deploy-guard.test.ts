import { describe, expect, it } from "vitest";
import { DEPLOY_TARGETS, evaluateDeployConfig, main, parseArgs } from "../scripts/deploy.mjs";

// `main` is driven with an injected resolver: these tests cover the guard's own
// behaviour (which resolved configs are refused, and what the refused deploy
// path exits with) without invoking wrangler — the real `image-service/wrangler.toml`
// resolution is exercised by `npm run deploy:check` in CI (`image-service-gate`).

type Env = "staging" | "production";

const LOCAL_VARS = {
  R2_ACCOUNT_ID: "local",
  R2_BUCKET_NAME: "coffeemode",
  R2_PUBLIC_URL: "http://localhost:9000/coffeemode",
  R2_ENDPOINT: "http://localhost:9000",
  UPLOAD_URL_TTL_SECONDS: "600",
};

/** The top-level local-dev kit values, as they resolve for any environment. */
function localConfig(env: Env) {
  return {
    name: `image-service-${env === "production" ? "prod" : env}`,
    vars: LOCAL_VARS,
    r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "coffeemode" }],
  };
}

function deployableConfig(env: Env) {
  const target = DEPLOY_TARGETS[env];
  return {
    name: target.worker,
    vars: {
      R2_ACCOUNT_ID: "bf69da5249b63731ad79545d0095e8db",
      R2_BUCKET_NAME: target.bucket,
      R2_PUBLIC_URL: target.publicUrl,
      R2_ENDPOINT: "",
      UPLOAD_URL_TTL_SECONDS: "600",
    },
    r2_buckets: [{ binding: "R2_BUCKET", bucket_name: target.bucket }],
  };
}

const NO_ENV_SECTION_FIXTURE = "tests/fixtures/wrangler.local-defaults.toml";
const LOCAL_VARS_FIXTURE = "tests/fixtures/wrangler.local-vars-in-env.toml";

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
    expect(parseArgs(["--env=production", "--config=custom.toml"]).env).toBe("production");
    expect(parseArgs(["--env=production", "--config=custom.toml"]).config).toBe("custom.toml");
  });
});

describe("evaluateDeployConfig", () => {
  it("accepts the staging and production targets", () => {
    for (const env of ["staging", "production"] as const) {
      expect(evaluateDeployConfig({ env, config: deployableConfig(env), hasEnvSection: true })).toEqual([]);
    }
  });

  it("flags every local-dev value, including the R2 bucket binding", () => {
    const reasons = evaluateDeployConfig({
      env: "production",
      config: localConfig("production"),
      hasEnvSection: true,
    }).join("\n");

    expect(reasons).toContain("R2_ACCOUNT_ID");
    expect(reasons).toContain("R2_BUCKET_NAME");
    expect(reasons).toContain("R2_PUBLIC_URL");
    expect(reasons).toContain("R2_ENDPOINT");
    expect(reasons).toContain("coffeemode-images-prod");
    expect(reasons).not.toMatch(/no \[env\.production\] section/);
  });

  it("flags a missing [env.<name>] section, the shape a bare deploy resolves to", () => {
    const reasons = evaluateDeployConfig({
      env: "production",
      config: localConfig("production"),
      hasEnvSection: false,
      configFile: "wrangler.toml",
    }).join("\n");

    expect(reasons).toMatch(/no \[env\.production\] section/);
  });

  it("flags a public CDN host that no longer matches the pinned target", () => {
    const config = deployableConfig("production");
    config.vars.R2_PUBLIC_URL = "https://staging-images.coffeemode.app";

    expect(
      evaluateDeployConfig({ env: "production", config, hasEnvSection: true }).join("\n"),
    ).toMatch(/R2_PUBLIC_URL/);
  });
});

describe("deploy path", () => {
  it("refuses a deploy whose resolved config still points at local dev", async () => {
    const { code, err } = await runGuard(["--env", "production", "--config", LOCAL_VARS_FIXTURE], localConfig("production"));

    expect(code).toBe(1);
    expect(err).toContain("R2_ACCOUNT_ID");
    expect(err).toContain("localhost:9000");
    expect(err).toMatch(/Nothing was deployed/);
  });

  it("refuses a deploy for an --env the config file does not declare", async () => {
    const { code, err } = await runGuard(
      ["--env", "production", "--config", NO_ENV_SECTION_FIXTURE],
      localConfig("production"),
    );

    expect(code).toBe(1);
    expect(err).toMatch(/no \[env\.production\] section/);
  });

  it("refuses a bare deploy with no --env", async () => {
    const { code, err } = await runGuard([], localConfig("production"));

    expect(code).toBe(2);
    expect(err).toContain("--env is required");
  });

  it("refuses an --env that is not a deploy target", async () => {
    const { code } = await runGuard(["--env", "preview"], localConfig("production"));

    expect(code).toBe(2);
  });

  it("lets the documented production config through in --check mode", async () => {
    const { code, out } = await runGuard(["--env", "production", "--check"], deployableConfig("production"));

    expect(code).toBe(0);
    expect(out).toContain("image-service-prod");
  });

  it("lets the documented staging config through in --check mode", async () => {
    const { code, out } = await runGuard(["--env=staging", "--check"], deployableConfig("staging"));

    expect(code).toBe(0);
    expect(out).toContain("image-service-staging");
  });
});
