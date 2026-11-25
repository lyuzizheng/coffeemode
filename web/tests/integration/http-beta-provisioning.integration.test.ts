/**
 * @vitest-environment node
 *
 * Closed-beta admission ACROSS TWO STORES (BRAWUKA-970, ADR-0010 §1).
 *
 * The application database owns the roster (`beta_allowlist`); Supabase owns
 * the Auth user store. With public sign-ups OFF, an address must ALSO exist in
 * Auth before its first Google sign-in, and an unprovisioned address cannot
 * get an account at all. This suite proves that contract against the compose
 * mock, whose admin API is the stand-in for the Supabase dashboard / Admin API
 * and whose `provisioned:<email>` verify seam answers exactly like GoTrue with
 * sign-ups disabled (`error_code=signup_disabled`).
 *
 * Covered:
 *   - `beta-allowlist.mjs add` writes the roster row AND provisions the Auth
 *     account (idempotent; `--no-provision` and a missing key degrade loudly);
 *   - first sign-in succeeds for a provisioned address, and the profile row is
 *     created only for an admitted identity;
 *   - an unprovisioned address gets the refusal page and leaves NO Auth user;
 *   - the roster stays authoritative: provisioned but uninvited is refused;
 *   - provider-side refusals route to `/beta?denied=1`, unrelated OAuth errors
 *     keep the generic path.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callbackGET } from "@/app/auth/callback/route";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

const execFileAsync = promisify(execFile);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sessionJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => Array.from(sessionJar.entries()).map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = sessionJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      sessionJar.set(name, value);
    },
    delete: (name: string) => {
      sessionJar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

const telemetry = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/observability/server-log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  emitAccessLine: vi.fn(),
  emitTelemetryLine: (line: Record<string, unknown>) => {
    telemetry.push(line);
  },
  getRequestId: () => "test-request",
  isValidRequestId: () => true,
  REQUEST_ID_HEADER: "x-request-id",
}));

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeBoundary = RUN_INTEGRATION ? describe : describe.skip;

const SUPABASE_URL = "http://127.0.0.1:54321";
const SECRET_KEY = "test-secret-key";
const TEST_DB = makeTestDbName("coffeemode_test_beta_provision");

/** Unique per run: the mock's Auth store lives for the whole process. */
const provisionedEmail = `provisioned-${randomUUID().slice(0, 8)}@closed-beta.test`;
const uninvitedEmail = `uninvited-${randomUUID().slice(0, 8)}@closed-beta.test`;
const ghostEmail = `ghost-${randomUUID().slice(0, 8)}@closed-beta.test`;
const rosterOnlyEmail = `roster-only-${randomUUID().slice(0, 8)}@closed-beta.test`;
const skippedEmail = `skipped-${randomUUID().slice(0, 8)}@closed-beta.test`;

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousEnv = { ...process.env };

/** Child env with the Supabase coordinates blanked: the CLI must warn, not guess. */
function rosterOnlyEnv(): typeof process.env {
  return {
    ...process.env,
    DATABASE_URL: testDbUrl,
    SUPABASE_URL: "",
    SUPABASE_SECRET_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "",
  };
}

async function profilesCount(): Promise<number> {
  const result = await dbClient.query<{ n: number }>("select count(*)::int as n from profiles");
  return result.rows[0].n;
}

async function mockAuthUsers(): Promise<{ id: string; email: string }[]> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: { authorization: `Bearer ${SECRET_KEY}` },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { users: { id: string; email: string }[] };
  return body.users;
}

function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("node", ["scripts/beta-allowlist.mjs", ...args], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: testDbUrl },
  });
}

function callback(url: string): Promise<Response> {
  return callbackGET(new Request(url, { headers: { host: "localhost:3000" } }));
}

function redirectTarget(response: Response): string {
  return response.headers.get("location") ?? "";
}

describeBoundary("boundary — closed-beta across Auth and app stores (BRAWUKA-970)", () => {
  beforeAll(async () => {
    const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (!health?.ok) {
      throw new Error(
        `supabase-mock is not reachable at ${SUPABASE_URL}. This suite needs the compose mock (docker compose up -d --wait supabase-mock).`,
      );
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-anon-key";
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = SECRET_KEY;
    process.env.BETA_MODE = "1";

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await closePool();
    } catch (err) {
      errors.push(err);
    }
    try {
      await dbClient?.end();
    } catch (err) {
      errors.push(err);
    }
    try {
      await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
    } catch (err) {
      errors.push(err);
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
    if (errors.length > 0) throw errors[0];
  }, 60_000);

  beforeEach(() => {
    sessionJar.clear();
    telemetry.length = 0;
  });

  describe("operator provisioning (one command, two stores)", () => {
    it("adds the roster row and provisions the Auth account", async () => {
      const added = await runCli("add", provisionedEmail, "--note", "e2e provisioned");
      expect(added.stdout).toContain(`invited  ${provisionedEmail}`);
      expect(added.stdout).toContain(`provisioned  ${provisionedEmail}`);

      const roster = await dbClient.query("select revoked_at from beta_allowlist where email = $1", [
        provisionedEmail,
      ]);
      expect(roster.rows).toHaveLength(1);
      expect(roster.rows[0].revoked_at).toBeNull();

      const users = await mockAuthUsers();
      expect(users.map((user) => user.email)).toContain(provisionedEmail);
    }, 30_000);

    it("re-runs idempotently: one roster row, one Auth account", async () => {
      const again = await runCli("add", provisionedEmail);
      expect(again.stdout).toContain(`already provisioned  ${provisionedEmail}`);

      const rows = await dbClient.query("select count(*)::int as n from beta_allowlist where email = $1", [
        provisionedEmail,
      ]);
      expect(rows.rows[0].n).toBe(1);
      const users = await mockAuthUsers();
      expect(users.filter((user) => user.email === provisionedEmail)).toHaveLength(1);
    }, 30_000);

    it("warns instead of pretending when no secret key is configured", async () => {
      const withoutKey = await execFileAsync(
        "node",
        ["scripts/beta-allowlist.mjs", "add", rosterOnlyEmail],
        { cwd: webRoot, env: rosterOnlyEnv() },
      );
      expect(withoutKey.stdout).toContain(`invited  ${rosterOnlyEmail}`);
      expect(withoutKey.stdout).toContain("warning: Supabase Auth not provisioned");

      const users = await mockAuthUsers();
      expect(users.map((user) => user.email)).not.toContain(rosterOnlyEmail);
    }, 30_000);

    it("honours --no-provision even when the secret key is available", async () => {
      const skipped = await runCli("add", skippedEmail, "--no-provision");
      expect(skipped.stdout).toContain(`invited  ${skippedEmail}`);
      expect(skipped.stdout).toContain("skipped Auth provisioning");

      const users = await mockAuthUsers();
      expect(users.map((user) => user.email)).not.toContain(skippedEmail);
    }, 30_000);
  });

  describe("first sign-in", () => {
    it("admits a provisioned, invited identity and writes its profile row", async () => {
      const before = await profilesCount();
      const response = await callback(
        `http://localhost:3000/auth/callback?token_hash=provisioned:${provisionedEmail}&type=magiclink`,
      );
      expect(response.status).toBe(302);
      expect(redirectTarget(response)).toBe("http://localhost:3000/");
      expect(await profilesCount()).toBe(before + 1);
    }, 30_000);

    it("refuses an address Supabase never provisioned, and leaves no Auth account", async () => {
      const before = await profilesCount();
      const response = await callback(
        `http://localhost:3000/auth/callback?token_hash=provisioned:${ghostEmail}&type=magiclink`,
      );
      expect(response.status).toBe(307);
      expect(redirectTarget(response)).toBe("http://localhost:3000/beta?denied=1");

      const users = await mockAuthUsers();
      expect(users.map((user) => user.email)).not.toContain(ghostEmail);
      expect(await profilesCount()).toBe(before);
      expect(telemetry.find((line) => line.type === "beta.denied")?.reason).toBe("signup_disabled");
    }, 30_000);

    it("keeps the roster authoritative: provisioned but uninvited is refused", async () => {
      // The Auth account exists (the mock stores it); the app still refuses
      // because the address is not on the roster.
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SECRET_KEY}`,
        },
        body: JSON.stringify({ email: uninvitedEmail, email_confirm: true }),
      });

      const response = await callback(
        `http://localhost:3000/auth/callback?token_hash=provisioned:${uninvitedEmail}&type=magiclink`,
      );
      expect(redirectTarget(response)).toBe("http://localhost:3000/beta?denied=1");
      expect(telemetry.find((line) => line.type === "beta.denied")?.reason).toBe("not_allowlisted");
    }, 30_000);
  });

  describe("provider-side refusals (sign-ups closed in Supabase)", () => {
    it("routes an unprovisioned Google attempt to the refusal page", async () => {
      const response = await callback(
        "http://localhost:3000/auth/callback?error=access_denied" +
          "&error_code=signup_disabled&error_description=Signups%20not%20allowed%20for%20this%20instance",
      );
      expect(response.status).toBe(307);
      expect(redirectTarget(response)).toBe("http://localhost:3000/beta?denied=1");
      expect(telemetry.find((line) => line.type === "beta.denied")?.reason).toBe("signup_disabled");
    });

    it("keeps an unrelated OAuth error on the generic path", async () => {
      const response = await callback(
        "http://localhost:3000/auth/callback?error=access_denied&error_description=User%20cancelled",
      );
      expect(redirectTarget(response)).toBe("http://localhost:3000/?auth=error");
      expect(telemetry.filter((line) => line.type === "beta.denied")).toHaveLength(0);
    });

    it("keeps a provider outage on the generic path", async () => {
      const response = await callback(
        "http://localhost:3000/auth/callback?error=server_error&error_description=upstream",
      );
      expect(redirectTarget(response)).toBe("http://localhost:3000/?auth=error");
    });
  });
});
