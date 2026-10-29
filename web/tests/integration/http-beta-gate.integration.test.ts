/**
 * @vitest-environment node
 *
 * Closed-beta admission boundary (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * Drives the REAL server boundary over the compose supabase-mock:
 *   - `proxy()` — anonymous, allowlisted, unlisted, and revoked page requests;
 *   - `apiRoute`-wrapped handlers — the JSON envelope for the same identities,
 *     plus the infra-probe exemptions;
 *   - `GET /auth/callback` + `completeSignIn` — where a refused identity is
 *     signed out and where an admitted one gets its profile row;
 *   - the `beta_allowlist` table, its `before-user-created` hook body, and the
 *     operator CLI that writes it.
 *
 * Every identity is a real fake JWT verified by the mock's `/auth/v1/user`, so
 * deleting `x-verified-user` forwarding, the admission check, or the allowlist
 * read breaks these tests rather than a mock's expectations.
 */
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { proxy } from "@/proxy";
import { GET as callbackGET } from "@/app/auth/callback/route";
import { GET as cafesGET } from "@/app/api/cafes/route";
import { GET as healthGET } from "@/app/api/health/route";
import { completeSignIn } from "@/lib/auth/sign-in-completion";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { betaDecisionFor } from "@/lib/beta/access";
import { betaModeOverride } from "@/lib/beta/config";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { fakeJwt } from "../../../scripts/fake-jwt.mjs";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

const execFileAsync = promisify(execFile);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Session cookies the proxy and the route handlers both read. `@supabase/ssr`
// goes through next/headers inside route handlers; the proxy reads the
// request's own cookies. One jar feeds both, so a case cannot pass by
// presenting different identities to the two boundaries.
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

// Audit trail sink: the `beta.denied` lines the gate emits.
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
const COOKIE_NAME = "sb-127-auth-token";
const TEST_DB = makeTestDbName("coffeemode_test_beta_gate");

const ALLOWED_EMAIL = "invited@example.com";
const UNLISTED_EMAIL = "stranger@example.com";
const REVOKED_EMAIL = "revoked@example.com";
const ALLOWED_ID = "e2e00000-0000-4000-a000-00000000b0a1";
const UNLISTED_ID = "e2e00000-0000-4000-a000-00000000b0a2";
const REVOKED_ID = "e2e00000-0000-4000-a000-00000000b0a3";

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Session cookie for one mock-verified identity (email rides the JWT). */
function sessionCookie(uid: string, email: string): string {
  const accessToken = fakeJwt(uid, { email });
  const session = {
    access_token: accessToken,
    refresh_token: `mock-refresh-${uid}`,
    user: { id: uid, email },
    expires_at: 9_999_999_999,
  };
  return `${COOKIE_NAME}=${encodeURIComponent(
    `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  )}`;
}

function pageRequest(path: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

function rewriteTarget(response: Response): string | null {
  return response.headers.get("x-middleware-rewrite");
}

function isPassThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

function apiRequest(path: string, cookie?: string): NextRequest {
  const headers: Record<string, string> | undefined = cookie ? { cookie } : undefined;
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

function deniedLines(): Record<string, unknown>[] {
  return telemetry.filter((line) => line.type === "beta.denied");
}

describeBoundary("boundary — closed-beta admission (BRAWUKA-970)", () => {
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
    // The gate is the subject of this suite: turn it on explicitly and let
    // `afterAll` hand the process back to the default (open) mode.
    process.env.BETA_MODE = "1";

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();

    // One live invitation, one revoked row: the difference between them is
    // exactly what the decision must honour.
    await dbClient.query(
      `insert into beta_allowlist (email, note, revoked_at) values
         ($1, 'e2e allowed', null),
         ($2, 'e2e revoked', now())
       on conflict (email) do update set revoked_at = excluded.revoked_at`,
      [ALLOWED_EMAIL, REVOKED_EMAIL],
    );
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
    process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousSupabaseAnonKey;
    }
    delete process.env.BETA_MODE;
    if (errors.length > 0) throw errors[0];
  }, 60_000);

  beforeEach(() => {
    sessionJar.clear();
    telemetry.length = 0;
  });

  describe("deployment flag", () => {
    it("reads BETA_MODE as the override and rejects an unrecognized value", () => {
      delete process.env.BETA_MODE;
      expect(betaModeOverride()).toBeNull();
      process.env.BETA_MODE = "0";
      expect(betaModeOverride()).toBe(false);
      process.env.BETA_MODE = " ON ";
      expect(betaModeOverride()).toBe(true);
      process.env.BETA_MODE = "ture";
      expect(() => betaModeOverride()).toThrow(/BETA_MODE/);
      process.env.BETA_MODE = "1";
    });
  });

  describe("page gate (proxy rewrite)", () => {
    it("rewrites an anonymous visitor on / and on a cafe deep link to the beta surface", async () => {
      for (const path of ["/", "/cafes/e2e00000-0000-4000-a000-00000000c001", "/profile"]) {
        const response = await proxy(pageRequest(path));
        expect(rewriteTarget(response), path).toMatch(/\/beta$/);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(isPassThrough(response)).toBe(false);
      }
    });

    it("leaves the beta surface, legal pages, and the auth callback reachable", async () => {
      for (const path of ["/beta", "/privacy", "/terms", "/about", "/auth/callback", "/sitemap.xml"]) {
        const response = await proxy(pageRequest(path));
        expect(isPassThrough(response), path).toBe(true);
        expect(rewriteTarget(response), path).toBeNull();
      }
    });

    it("admits an allowlisted session and forwards its verified identity", async () => {
      const response = await proxy(pageRequest("/", sessionCookie(ALLOWED_ID, ALLOWED_EMAIL)));
      expect(isPassThrough(response)).toBe(true);
      expect(rewriteTarget(response)).toBeNull();
      expect(response.headers.get("x-middleware-request-x-verified-user")).toContain("v1.");
    });

    it("rewrites an unlisted session to the refusal copy and audits the attempt", async () => {
      const response = await proxy(pageRequest("/", sessionCookie(UNLISTED_ID, UNLISTED_EMAIL)));
      expect(rewriteTarget(response)).toMatch(/\/beta\?denied=1$/);

      const [line] = deniedLines();
      expect(line?.reason).toBe("not_allowlisted");
      expect(typeof line?.email_hash).toBe("string");
      // The audit trail carries a digest and a reason, never the address or a
      // token: the raw line must not be reconstructible from the log.
      const raw = JSON.stringify(line);
      expect(raw).not.toContain(UNLISTED_EMAIL);
      expect(raw).not.toContain("eyJ");
    });

    it("rewrites a revoked address even though its session still verifies", async () => {
      const response = await proxy(pageRequest("/", sessionCookie(REVOKED_ID, REVOKED_EMAIL)));
      expect(rewriteTarget(response)).toMatch(/\/beta\?denied=1$/);
      expect(deniedLines()[0]?.reason).toBe("not_allowlisted");
    });

    it("keeps the og-image route reachable instead of rewriting it to the beta page", async () => {
      // A social crawler asking for the card must get the image route, not an
      // HTML page: the gate owns pages, not public assets (BRAWUKA-970).
      const response = await proxy(
        pageRequest(`/cafes/${ALLOWED_ID}/og-image`),
      );
      expect(isPassThrough(response)).toBe(true);
      expect(rewriteTarget(response)).toBeNull();
    });

    it("treats an unverifiable session as anonymous (fail closed)", async () => {
      const forged = `${COOKIE_NAME}=${encodeURIComponent("base64-not-a-session")}`;
      const response = await proxy(pageRequest("/", forged));
      expect(rewriteTarget(response)).toMatch(/\/beta$/);
    });
  });

  describe("revocation (BRAWUKA-972 criterion 1)", () => {
    const MID_EMAIL = "revoked-mid-session@example.com";
    const MID_ID = "e2e00000-0000-4000-a000-00000000b0a4";

    it("refuses the very next page and API request after a revoke, with no cache reset", async () => {
      await dbClient.query(
        `insert into beta_allowlist (email, note, revoked_at) values ($1, 'revoke probe', null)
         on conflict (email) do update set revoked_at = null`,
        [MID_EMAIL],
      );
      const cookie = sessionCookie(MID_ID, MID_EMAIL);
      expect(isPassThrough(await proxy(pageRequest("/", cookie)))).toBe(true);
      sessionJar.set(COOKIE_NAME, cookie.split("=")[1]);
      expect((await cafesGET(apiRequest("/api/cafes?lat=1.35&lng=103.8", cookie))).status).toBe(200);

      await dbClient.query("update beta_allowlist set revoked_at = now() where email = $1", [MID_EMAIL]);

      // No reset, no wait: the next request is the proof.
      const page = await proxy(pageRequest("/", cookie));
      expect(rewriteTarget(page)).toMatch(/\/beta\?denied=1$/);
      const api = await cafesGET(apiRequest("/api/cafes?lat=1.35&lng=103.8", cookie));
      expect(api.status).toBe(403);
      expect(deniedLines().length).toBe(2);
    });
  });

  describe("API gate (guard)", () => {
    const CAFES = "/api/cafes?lat=1.35&lng=103.8";

    it("answers an anonymous caller with 401 and no product data", async () => {
      const response = await cafesGET(apiRequest(CAFES));
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("unauthorized");
    });

    it("answers an unlisted signed-in caller with 403 beta_not_allowed", async () => {
      sessionJar.set(COOKIE_NAME, sessionCookie(UNLISTED_ID, UNLISTED_EMAIL).split("=")[1]);
      const response = await cafesGET(apiRequest(CAFES, sessionCookie(UNLISTED_ID, UNLISTED_EMAIL)));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("beta_not_allowed");
      expect(deniedLines()[0]?.reason).toBe("not_allowlisted");
    });

    it("serves an allowlisted caller", async () => {
      const cookie = sessionCookie(ALLOWED_ID, ALLOWED_EMAIL);
      // Route handlers resolve the caller through next/headers; seed it so the
      // request and the handler cannot disagree about who is asking.
      sessionJar.set(COOKIE_NAME, cookie.split("=")[1]);
      const response = await cafesGET(apiRequest(CAFES, cookie));
      expect(response.status).toBe(200);
      expect(Array.isArray((await response.json()).cafes)).toBe(true);
    });

    it("keeps the infra probes exempt", async () => {
      const response = await healthGET(apiRequest("/api/health"));
      expect(response.status).toBe(200);
    });
  });

  describe("session establishment", () => {
    function fakeUser(id: string, email: string): User {
      return {
        id,
        email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: { full_name: "Beta Gate Fixture" },
        created_at: new Date().toISOString(),
      } as User;
    }

    it("refuses a magic-link callback for an unlisted address and leaves no profile row", async () => {
      const before = await dbClient.query<{ count: string }>("select count(*) from profiles");
      // The mock's verify endpoint issues `local@coffeemode.test`, which this
      // suite never invites: the callback must land on the refusal screen
      // instead of `/`, or the beta page would be unreachable for it.
      const response = await callbackGET(
        new Request("http://localhost:3000/auth/callback?token_hash=beta-gate-token&type=magiclink", {
          headers: { host: "localhost:3000" },
        }),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/beta?denied=1");
      expect(deniedLines().length).toBeGreaterThan(0);

      expect(await betaDecisionFor("local@coffeemode.test")).toEqual({
        allowed: false,
        reason: "not_allowlisted",
      });
      const after = await dbClient.query<{ count: string }>("select count(*) from profiles");
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it("admits an allowlisted identity and upserts its profile row", async () => {
      const supabase = await createSupabaseServerClient();
      sessionJar.set(COOKIE_NAME, sessionCookie(ALLOWED_ID, ALLOWED_EMAIL).split("=")[1]);

      const outcome = await completeSignIn({
        request: new Request("http://localhost:3000/auth/callback", { headers: { host: "localhost:3000" } }),
        supabase,
        user: fakeUser(ALLOWED_ID, ALLOWED_EMAIL),
        route: "GET /auth/callback",
      });

      expect(outcome).toBe("ok");
      const profile = await dbClient.query("select display_name from profiles where id = $1", [ALLOWED_ID]);
      expect(profile.rows).toHaveLength(1);
    });

    it("refuses an unlisted identity, signs the session out, and writes no profile row", async () => {
      const supabase = await createSupabaseServerClient();
      sessionJar.set(COOKIE_NAME, sessionCookie(UNLISTED_ID, UNLISTED_EMAIL).split("=")[1]);

      const outcome = await completeSignIn({
        request: new Request("http://localhost:3000/auth/callback", { headers: { host: "localhost:3000" } }),
        supabase,
        user: fakeUser(UNLISTED_ID, UNLISTED_EMAIL),
        route: "GET /auth/callback",
      });

      expect(outcome).toBe("beta_denied");
      const profile = await dbClient.query("select 1 from profiles where id = $1", [UNLISTED_ID]);
      expect(profile.rows).toHaveLength(0);
      const [line] = deniedLines();
      expect(line?.route).toBe("GET /auth/callback beta-gate");
      expect(line?.email_hash).toEqual(expect.any(String));
    });
  });

  describe("operator surface", () => {
    it("enforces the allowlist inside the before-user-created hook body", async () => {
      await expect(
        dbClient.query(`select beta_before_user_created('{"user":{"email":"ghost@example.com"}}'::jsonb)`),
      ).rejects.toThrow(/not on the beta allowlist/);

      const allowed = await dbClient.query(
        `select beta_before_user_created('{"user":{"email":"INVITED@example.com"}}'::jsonb) as result`,
      );
      expect(allowed.rows[0].result).toEqual({});
    });

    it("adds, lists, and revokes an address through the operator CLI", async () => {
      const run = (...args: string[]) =>
        execFileAsync("node", ["scripts/beta-allowlist.mjs", ...args], {
          cwd: webRoot,
          env: { ...process.env, DATABASE_URL: testDbUrl },
        });

      const added = await run("add", "Operator@Example.com", "--note", "e2e operator");
      expect(added.stdout).toContain("invited  operator@example.com");

      const listed = await run("list", "--json");
      const rows = JSON.parse(listed.stdout) as { email: string; revoked_at: string | null }[];
      expect(rows.map((row) => row.email)).toContain("operator@example.com");

      const removed = await run("remove", "operator@example.com");
      expect(removed.stdout).toContain("revoked  operator@example.com");

      expect(await betaDecisionFor("operator@example.com")).toEqual({
        allowed: false,
        reason: "not_allowlisted",
      });
    }, 30_000);

    it("rejects a malformed address instead of writing it", async () => {
      await expect(
        execFileAsync("node", ["scripts/beta-allowlist.mjs", "add", "not-an-email"], {
          cwd: webRoot,
          env: { ...process.env, DATABASE_URL: testDbUrl },
        }),
      ).rejects.toThrow(/not an email address/);
    }, 30_000);
  });
});
