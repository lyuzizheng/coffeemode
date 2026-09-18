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
import { getCurrentUser } from "@/lib/auth/get-user";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
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
const previousSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describeIntegration("integration — real Supabase auth exchange & token verification (BRAWUKA-417)", () => {
  beforeAll(async () => {
    mockUp = await supabaseMockReachable();
    if (!mockUp) {
      throw new Error(
        `supabase-mock is not reachable at ${SUPABASE_MOCK_URL}. Real exchange integration tests require a running supabase-mock instance (docker compose up -d --wait supabase-mock).`,
      );
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_MOCK_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

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

    if (previousSupabaseAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousSupabaseAnonKey;

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
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback?code=mock-exchange-code-123"));
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
    expect(currentUser).toEqual({ id: "c935f899-11fd-4782-a173-777b3995384b" });
  });

  it("honors safe next parameter after successful exchange", async () => {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback" },
    });

    const res = await callbackGET(
      new Request("http://localhost:3000/auth/callback?code=mock-exchange-code-123&next=%2Fcafes%2Fexplore"),
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

  it("negative path: GET /auth/callback redirects to /?auth=error when code is missing", async () => {
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("negative path: GET /auth/callback redirects to /?auth=error when PKCE code verifier is missing", async () => {
    // No verifier cookie in jar
    cookieJar.clear();
    const res = await callbackGET(new Request("http://localhost:3000/auth/callback?code=unverified-code"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });
});
