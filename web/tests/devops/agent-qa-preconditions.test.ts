import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_QA_JOURNEYS, planRound } from "../../../scripts/agent-qa/journeys.mjs";
import {
  AGENT_QA_PRECONDITION_NAMES,
  evaluateAgentQaPreconditions,
} from "../../../scripts/agent-qa/preconditions.mjs";

// BRAWUKA-955: `planRound(satisfied)` used to take a set the QA agent inferred
// from prompt prose every round. After BRAWUKA-950 renamed the Supabase keys
// that prose still named the retired variables, so seven journeys reported
// `blocked (supabase-keys missing)` while the staging triple resolved fine
// (the keepalive autopilot proved it with a 200 on `/rest/v1/cafes`).
//
// The contract under test: one deterministic evaluator derives the set from the
// env through the same resolvers the runner uses, reports exact gaps by
// variable name, and never prints a value.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/agent-qa/preconditions.mjs");

const STAGING_URL = "https://ojujmjewtbquiddswyrg.supabase.co";

const NEW_KEY_NAMES = {
  SUPABASE_URL: STAGING_URL,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_sentinel",
  SUPABASE_SECRET_KEY: "sb_secret_test_sentinel",
};

const LEGACY_KEY_NAMES = {
  SUPABASE_URL: STAGING_URL,
  SUPABASE_ANON_KEY: "anon_test_sentinel",
  SUPABASE_SERVICE_ROLE_KEY: "service_test_sentinel",
};

const ACCESS_PAIR = {
  CF_ACCESS_CLIENT_ID: "access-id-sentinel",
  CF_ACCESS_CLIENT_SECRET: "access-secret-sentinel",
};

const MISSING_URL = "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)";
const MISSING_PUBLISHABLE =
  "SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; legacy SUPABASE_ANON_KEY accepted)";
const MISSING_SECRET =
  "SUPABASE_SECRET_KEY (server-side only, never NEXT_PUBLIC_*; legacy SUPABASE_SERVICE_ROLE_KEY accepted)";

/**
 * A hermetic env for the CLI: nothing from this machine leaks in, so a
 * developer's own staging variables cannot mask a missing contract in CI.
 */
function cliEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test", ...env };
}

/** The same env with one variable removed — a gap without mutating the fixture. */
function without(env: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

describe("agent-QA preconditions (BRAWUKA-955)", () => {
  describe("supabase-keys across the key-name migration", () => {
    it("is satisfied with only the new publishable/secret names", () => {
      const result = evaluateAgentQaPreconditions(NEW_KEY_NAMES);

      expect(result.satisfied).toContain("supabase-keys");
      expect(result.missing).not.toContain("supabase-keys");
      expect(result.missingVariables).not.toHaveProperty("supabase-keys");
    });

    it("is satisfied with only the legacy anon/service_role names", () => {
      const result = evaluateAgentQaPreconditions(LEGACY_KEY_NAMES);

      expect(result.satisfied).toContain("supabase-keys");
      expect(result.missing).not.toContain("supabase-keys");
    });

    it("is satisfied when both name sets are present", () => {
      const result = evaluateAgentQaPreconditions({
        ...LEGACY_KEY_NAMES,
        ...ACCESS_PAIR,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_sentinel",
        SUPABASE_SECRET_KEY: "sb_secret_test_sentinel",
      });

      expect(result.satisfied).toContain("supabase-keys");
      expect(result.missing).toEqual([]);
    });

    it("names the URL when only it is absent", () => {
      expect(
        evaluateAgentQaPreconditions(without(NEW_KEY_NAMES, "SUPABASE_URL")).missingVariables[
          "supabase-keys"
        ],
      ).toEqual([MISSING_URL]);
    });

    it("names the publishable key when only it is absent", () => {
      expect(
        evaluateAgentQaPreconditions(without(NEW_KEY_NAMES, "SUPABASE_PUBLISHABLE_KEY"))
          .missingVariables["supabase-keys"],
      ).toEqual([MISSING_PUBLISHABLE]);
    });

    it("names the secret key when only it is absent", () => {
      expect(
        evaluateAgentQaPreconditions(without(NEW_KEY_NAMES, "SUPABASE_SECRET_KEY")).missingVariables[
          "supabase-keys"
        ],
      ).toEqual([MISSING_SECRET]);
    });
  });

  describe("access-token", () => {
    it("is satisfied when both Access variables are set", () => {
      const result = evaluateAgentQaPreconditions(ACCESS_PAIR);

      expect(result.satisfied).toContain("access-token");
      expect(result.missing).not.toContain("access-token");
    });

    it("names both variables when the pair is absent", () => {
      const result = evaluateAgentQaPreconditions({});

      expect(result.missing).toContain("access-token");
      expect(result.missingVariables["access-token"]).toEqual([
        "CF_ACCESS_CLIENT_ID",
        "CF_ACCESS_CLIENT_SECRET",
      ]);
    });
  });

  it("classifies every precondition the registry declares", () => {
    const registryNames = [
      ...new Set(
        AGENT_QA_JOURNEYS.flatMap((journey) => journey.preconditions.map((entry) => entry.name)),
      ),
    ];
    expect([...AGENT_QA_PRECONDITION_NAMES]).toEqual(registryNames);

    const result = evaluateAgentQaPreconditions({ ...NEW_KEY_NAMES, ...ACCESS_PAIR });
    const classified = [...result.satisfied, ...result.missing, ...result.unverified];
    expect([...classified].sort()).toEqual([...registryNames].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("reports preconditions with no env contract as unverified, never satisfied", () => {
    const result = evaluateAgentQaPreconditions({ ...NEW_KEY_NAMES, ...ACCESS_PAIR });

    expect(result.satisfied).toEqual(["access-token", "supabase-keys"]);
    expect(result.unverified).toEqual([
      "image-service-staging",
      "turnstile-present",
      "second-persona",
    ]);
  });

  it("makes every supabase-keys journey runnable once the triple resolves", () => {
    const result = evaluateAgentQaPreconditions({ ...NEW_KEY_NAMES, ...ACCESS_PAIR });
    const { runnable, blocked } = planRound(result.satisfied);

    expect(runnable.map((journey) => journey.id)).toEqual([
      "p0-anonymous-discovery",
      "p1-login-checkin",
      "p1-profile",
      "p2-search",
      "p2-create-cafe",
      "p3-lifecycle-delete-cafe",
    ]);
    expect(blocked.map((entry) => [entry.journey.id, entry.missing])).toEqual([
      ["p2-photo-upload", ["image-service-staging"]],
      ["p3-maps-link-import", ["turnstile-present"]],
      ["p3-social-like", ["second-persona"]],
    ]);
  });

  describe("CLI", () => {
    it("prints the satisfied set and never a key value", () => {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: "utf8",
        env: cliEnv({ ...NEW_KEY_NAMES, ...ACCESS_PAIR }),
      });
      const result = JSON.parse(stdout);

      expect(result.satisfied).toEqual(["access-token", "supabase-keys"]);
      expect(result.missing).toEqual([]);
      for (const sentinel of [
        NEW_KEY_NAMES.SUPABASE_PUBLISHABLE_KEY,
        NEW_KEY_NAMES.SUPABASE_SECRET_KEY,
        ACCESS_PAIR.CF_ACCESS_CLIENT_ID,
        ACCESS_PAIR.CF_ACCESS_CLIENT_SECRET,
      ]) {
        expect(stdout).not.toContain(sentinel);
      }
    });

    it("reports a precise gap without failing the evaluation", () => {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: "utf8",
        env: cliEnv(without(NEW_KEY_NAMES, "SUPABASE_SECRET_KEY")),
      });
      const result = JSON.parse(stdout);

      expect(result.missing).toContain("supabase-keys");
      expect(result.missingVariables["supabase-keys"]).toEqual([MISSING_SECRET]);
    });

    it("prints usage with --help", () => {
      const stdout = execFileSync(process.execPath, [SCRIPT, "--help"], {
        encoding: "utf8",
        env: cliEnv({}),
      });

      expect(stdout).toContain("planRound");
      expect(stdout).toContain("missingVariables");
    });

    it("fails fast on an unknown flag", () => {
      let status: number | undefined;
      try {
        execFileSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8", env: cliEnv({}) });
      } catch (error) {
        // A non-zero spawn outcome surfaces as an Error carrying `status`.
        if (error instanceof Error && "status" in error && typeof error.status === "number") {
          status = error.status;
        }
      }

      expect(status).toBe(2);
    });
  });
});
