import { describe, expect, it } from "vitest";
import { DEPLOY_TARGETS, evaluateDeployConfig, parseArgs } from "../scripts/deploy.mjs";

type Env = "staging" | "production";

function configuredConfig(env: Env) {
  return {
    name: DEPLOY_TARGETS[env].worker,
    r2_buckets: [{ binding: "TILES_BUCKET", bucket_name: DEPLOY_TARGETS[env].bucket }],
  };
}

describe("parseArgs", () => {
  it("reads --env/--check/--config and forwards everything else to wrangler", () => {
    expect(parseArgs(["--env", "staging", "--check"])).toEqual({
      env: "staging",
      config: undefined,
      check: true,
      passthrough: [],
    });
    expect(parseArgs(["--env=production"]).env).toBe("production");
  });
});

describe("evaluateDeployConfig", () => {
  it("accepts the configured staging and production targets", () => {
    for (const env of ["staging", "production"] as const) {
      expect(
        evaluateDeployConfig({ env, config: configuredConfig(env), hasEnvSection: true }),
      ).toEqual([]);
    }
  });

  it("refuses the local-dev placeholder bucket", () => {
    const violations = evaluateDeployConfig({
      env: "staging",
      config: {
        name: "tiles-service-staging",
        r2_buckets: [{ binding: "TILES_BUCKET", bucket_name: "cafemode-maptiles-local" }],
      },
      hasEnvSection: true,
    });
    expect(violations.join("\n")).toMatch(/local-dev placeholder/);
  });

  it("refuses a wrong worker name and a missing env section", () => {
    const violations = evaluateDeployConfig({
      env: "production",
      config: configuredConfig("staging"),
      hasEnvSection: false,
    });
    expect(violations.join("\n")).toMatch(/no \[env\.production\] section/);
    expect(violations.join("\n")).toMatch(/expected "tiles-service-prod"/);
  });

  it("refuses a missing bucket binding", () => {
    const violations = evaluateDeployConfig({
      env: "staging",
      config: { name: "tiles-service-staging", r2_buckets: [] },
      hasEnvSection: true,
    });
    expect(violations.join("\n")).toMatch(/no TILES_BUCKET binding/);
  });
});
