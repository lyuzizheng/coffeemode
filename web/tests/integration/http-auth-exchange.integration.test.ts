/**
 * @vitest-environment node
 *
 * Real Supabase exchange & token verification integration test (BRAWUKA-417).
 * Closes S2 audit gap (test-coverage.md §4):
 * - Real OAuth PKCE setup and code exchange against supabase-mock (/auth/v1/token);
 * - Real Postgres profile upsert on callback (upsertProfile in /auth/callback);
 * - Real JWT verification against supabase-mock (/auth/v1/user) via getCurrentUser();
 * - Negative verification: invalid/tampered tokens are rejected by supabase-mock (401)
 *   and getCurrentUser() gracefully returns null.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callbackGET } from "@/app/auth/callback/route";
import { POST as sessionPOST } from "@/app/api/auth/session/route";
import { getCurrentUser } from "@/lib/auth/get-user";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { fakeJwt } from "../helpers/auth";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

interface CookieRecord {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}
const cookieJar = new Map<string, CookieRecord>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => Array.from(cookieJar.values()).map((c) => ({ name: c.name, value: c.value })),
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieJar.set(name, { name, value, options });
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

const SUPABASE_MOCK_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";

async function supabaseMockReachable(url = SUPABASE_MOCK_URL): Promise<boolean> {
  try {
    const res = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_test_auth_exchange");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
let mockUp = false;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describeIntegration("integration — real Supabase auth exchange & token verification (BRAWUKA-417)", () => {
  beforeAll(async () => {
    mockUp = await supabaseMockReachable();
    if (!mockUp) {
      throw new Error(
        `supabase-mock is not reachable at ${SUPABASE_MOCK_URL}. Real exchange integration tests require a running supabase-mock instance (docker compose up -d --wait supabase-mock).`,
      );
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_MOCK_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-anon-key";

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  beforeEach(async () => {
    cookieJar.clear();
    if (dbClient) {
      await dbClient.query("delete from profiles where id = 'c935f899-11fd-4782-a173-777b3995384b'");
    }
  });

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
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;

    if (previousSupabaseAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousSupabaseAnonKey;

    if (RUN_INTEGRATION && testDbUrl) {
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "http-auth-exchange integration cleanup failed");
    }
  }, 60_000);

  it("initiates OAuth, completes real code exchange on GET /auth/callback, and upserts profile into Postgres", async () => {
    // 1. Initiate OAuth to establish the PKCE code verifier cookie in our store
    const supabase = await createSupabaseServerClient();
    const signInRes = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: "http://localhost:3000/auth/callback" },
    });
    expect(signInRes.error).toBeNull();
    expect(signInRes.data.url).toContain("code_challenge");
    expect(Array.from(cookieJar.keys()).some((k) => k.includes("code-verifier"))).toBe(true);

    // 2. Simulate browser redirect back with authorization code
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback?code=mock-exchange-code-123", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");

    // 3. Verify session was stored in cookies
    const hasAuthCookie = Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"));
    expect(hasAuthCookie).toBe(true);

    // 4. Verify profile row was created in real Postgres
    const profileRes = await dbClient.query<{ id: string; display_name: string }>(
      "select id, display_name from profiles where id = 'c935f899-11fd-4782-a173-777b3995384b'",
    );
    expect(profileRes.rows).toHaveLength(1);
    expect(profileRes.rows[0].display_name).toBe("local");

    // 5. Verify real token validation via getCurrentUser() calling supabase-mock /auth/v1/user
    const currentUser = await getCurrentUser();
    expect(currentUser).toMatchObject({ id: "c935f899-11fd-4782-a173-777b3995384b" });
  });

  it("honors safe next parameter after successful exchange", async () => {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback" },
    });

    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?code=mock-exchange-code-123&next=%2Fcafes%2Fexplore", { headers: { host: "localhost:3000" } }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/cafes/explore");
  });

  it("negative path: rejects tampered JWT and returns null in getCurrentUser()", async () => {
    // Manually forge a session cookie with a corrupted token
    const authCookieName = "sb-127-auth-token";
    cookieJar.set(authCookieName, {
      name: authCookieName,
      value: JSON.stringify({
        access_token: "header.corruptedpayload.invalidsig",
        refresh_token: "fake-refresh",
      }),
    });

    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it("redirects a bare callback to / (no credentials, nothing to exchange)", async () => {
    // A browser can land here with the magic-link tokens in the URL hash, which
    // never reaches the server. A 400 would strand that bootstrap; the home
    // page's HashSessionBridge consumes the fragment instead (BRAWUKA-956).
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("negative path: GET /auth/callback redirects to /?auth=error when the provider reports an error", async () => {
    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?error=access_denied", { headers: { host: "localhost:3000" } }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("completes a magic-link token_hash sign-in and persists the session cookie (BRAWUKA-956)", async () => {
    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?token_hash=mock-magic-token-hash&type=magiclink", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");

    expect(Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"))).toBe(true);

    const profileRes = await dbClient.query<{ id: string }>(
      "select id from profiles where id = 'c935f899-11fd-4782-a173-777b3995384b'",
    );
    expect(profileRes.rows).toHaveLength(1);

    // The cookie must be a real session: /auth/v1/user accepts its bearer.
    const currentUser = await getCurrentUser();
    expect(currentUser).toMatchObject({ id: "c935f899-11fd-4782-a173-777b3995384b" });
  });

  it("honors safe next parameter after a successful magic-link sign-in", async () => {
    const res = await callbackGET(
      new Request(
        "http://localhost:3000/auth/callback?token_hash=mock-magic-token-hash&type=magiclink&next=%2Fcafes%2Fexplore",
        { headers: { host: "localhost:3000" } },
      ),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/cafes/explore");
  });

  it("rejects an incomplete token_hash callback with HTTP 400", async () => {
    for (const query of ["token_hash=mock-magic-token-hash", "type=magiclink"]) {
      const res = await callbackGET(
        new Request(`http://localhost:3000/auth/callback?${query}`, { headers: { host: "localhost:3000" } }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
  });

  it("rejects an unsupported OTP type with HTTP 400", async () => {
    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?token_hash=mock-magic-token-hash&type=password", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("negative path: an expired token_hash redirects to /?auth=error and stores no session", async () => {
    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?token_hash=expired-magic-token-hash&type=magiclink", {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
    expect(Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"))).toBe(false);
  });

  it("negative path: GET /auth/callback redirects to /?auth=error when PKCE code verifier is missing", async () => {
    // No verifier cookie in jar
    cookieJar.clear();
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback?code=unverified-code", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("establishes a session from the magic-link token pair on POST /api/auth/session (BRAWUKA-956)", async () => {
    const accessToken = fakeJwt("c935f899-11fd-4782-a173-777b3995384b", {
      email: "local@coffeemode.test",
    });

    const res = await sessionPOST(sessionRequest({ access_token: accessToken, refresh_token: "mock-refresh-c935f899-11fd-4782-a173-777b3995384b" }));

    expect(res.status).toBe(204);
    expect(Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"))).toBe(true);

    const profileRes = await dbClient.query<{ id: string }>(
      "select id from profiles where id = 'c935f899-11fd-4782-a173-777b3995384b'",
    );
    expect(profileRes.rows).toHaveLength(1);

    const currentUser = await getCurrentUser();
    expect(currentUser).toMatchObject({ id: "c935f899-11fd-4782-a173-777b3995384b" });
  });

  it("rejects a token pair that does not verify, and stores no session", async () => {
    const res = await sessionPOST(
      sessionRequest({ access_token: "header.corruptedpayload.invalidsig", refresh_token: "fake-refresh" }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"))).toBe(false);
  });

  it("rejects a session POST that omits either token", async () => {
    for (const body of [{ access_token: "only-access" }, { refresh_token: "only-refresh" }, {}]) {
      const res = await sessionPOST(sessionRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
  });

  it("rejects a cross-site session POST before it reaches Supabase", async () => {
    const res = await sessionPOST(
      sessionRequest(
        { access_token: fakeJwt("c935f899-11fd-4782-a173-777b3995384b"), refresh_token: "r" },
        { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      ),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden_origin" });
    expect(Array.from(cookieJar.keys()).some((k) => k.includes("auth-token"))).toBe(false);
  });
});

/** A same-origin JSON POST to /api/auth/session — the shape the bridge sends. */
function sessionRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/auth/session", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}
