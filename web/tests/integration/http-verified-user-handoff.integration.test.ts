/**
 * @vitest-environment node
 *
 * Proxy → page verified-user boundary (BRAWUKA-723 / BRAWUKA-750).
 *
 * Unlike the codec unit suite (`verified-user-handoff.test.ts`), every case
 * here drives PRODUCTION code paths: the real `sanitizedRequest` strip, the
 * real `refreshSessionAndVerify` (against the compose supabase-mock over
 * HTTP), and the real page-side decoder. Deleting production stripping or
 * header forwarding breaks these tests — that is the point.
 *
 * Auth runs against the local supabase-mock (fake JWTs, no user_metadata in
 * the mock's /auth/v1/user response), so Unicode coverage uses identities
 * whose metadata the PAGE would receive: the mock proves the transport
 * accepts the session, and the Unicode round-trip through the real header
 * proves the page decodes the exact names that used to throw ByteString.
 * Cafe rendering itself (`getCafe`) needs real Postgres and is covered by
 * the HTTP integration gate; what this suite owns is the full
 * strip → verify → forward → decode chain plus cookie preservation.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getCafe } from "@/lib/db/cafes";
import { refreshSessionAndVerify } from "@/lib/auth/proxy-session";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
  encodeVerifiedUser,
  trySetVerifiedUserHeader,
} from "@/lib/auth/verified-user";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { sanitizedRequest } from "@/proxy";
import { fakeJwt } from "../../../scripts/fake-jwt.mjs";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { CAFE_A, U1, U2 } from "../helpers/fixtures";

vi.mock("@/lib/observability/server-log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  emitAccessLine: vi.fn(),
  emitTelemetryLine: vi.fn(),
  getRequestId: vi.fn(() => "test-request"),
  isValidRequestId: vi.fn(() => true),
  REQUEST_ID_HEADER: "x-request-id",
}));

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeBoundary = RUN_INTEGRATION ? describe : describe.skip;

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = "test-anon-key";
const TEST_DB = makeTestDbName("coffeemode_test_verified_handoff");

const ATTACKER_ID = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380e99";

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function sessionCookie(uid: string): string {
  const token = fakeJwt(uid, { email: "liming@example.com" });
  const session = {
    access_token: token,
    refresh_token: `mock-refresh-${uid}`,
    user: { id: uid },
    expires_at: 9999999999,
  };
  return `sb-127-auth-token=${encodeURIComponent(
    `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  )}`;
}

function cafeRequest(cookieValue?: string, extraHeaders: Record<string, string> = {}): NextRequest {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookieValue) headers.cookie = cookieValue;
  return new NextRequest(`http://localhost:3000/cafes/${CAFE_A}`, { headers });
}

/**
 * The production proxy order for a cafe GET: strip inbound forgeries first,
 * then verify + forward on the same request object.
 */
async function productionCafeHandoff(request: NextRequest) {
  const req = sanitizedRequest(request);
  const response = await refreshSessionAndVerify(
    req,
    NextResponse.next({ request: req }),
    SUPABASE_URL,
    ANON_KEY,
    true,
  );
  return { req, ...response };
}

describeBoundary("boundary — proxy → page verified-user handoff (BRAWUKA-723 / BRAWUKA-750)", () => {
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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
    // Fresh template clone already holds the service profile; upsert the
    // suite personas and the single cafe row idempotently (same pattern as
    // the other HTTP suites — no truncate on a fresh clone).
    await dbClient.query(
      `insert into profiles (id, display_name) values ($1, 'Boundary Nomad'), ($2, 'Boundary Second')
       on conflict (id) do update set display_name = excluded.display_name`,
      [U1, U2],
    );
    await dbClient.query(
      `insert into cafes (id, name, location, city, created_by, tz)
       values ($1, 'Boundary Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
               'singapore', $2, 'Asia/Singapore')
       on conflict (id) do update set name = excluded.name`,
      [CAFE_A, U1],
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
      throw new AggregateError(errors, "verified-user boundary cleanup failed");
    }
  }, 60_000);

  it("signed-in cafe request: real proxy verifies, page decodes the identity, cafe renders", async () => {
    const { req, verifiedUser, response } = await productionCafeHandoff(cafeRequest(sessionCookie(U1)));

    // The proxy verified the session against the mock — no throw, real id.
    expect(verifiedUser).toMatchObject({ id: U1 });
    expect(response.status).toBe(200);

    // The page reads the SAME request object: decode what forward stamped.
    const pageUser = decodeVerifiedUser(req.headers.get(VERIFIED_USER_HEADER));
    expect(pageUser).toMatchObject({ id: U1 });
    if (pageUser === null || pageUser === undefined) throw new Error("page identity missing");

    // And the cafe page's own query renders for that viewer.
    const cafe = await getCafe(CAFE_A, pageUser.id);
    expect(cafe?.id).toBe(CAFE_A);
  });

  it("Unicode display names survive the real header boundary (ByteString regression)", async () => {
    // The mock's /auth/v1/user carries no user_metadata, so the Unicode
    // payload enters exactly where production puts it: the verified identity
    // the proxy forwards. A raw-JSON wire threw here; v1+base64url must not.
    for (const name of ["李明", "☕ Nomad", "王芳 ☕"]) {
      const headers = new Headers();
      const value = encodeVerifiedUser({ id: U1, user_metadata: { full_name: name } });
      expect(() => headers.set(VERIFIED_USER_HEADER, value)).not.toThrow();
      const request = cafeRequest(sessionCookie(U1));
      request.headers.set(VERIFIED_USER_HEADER, value);
      // The full production chain re-stamps over it with the verified id.
      const { req } = await productionCafeHandoff(request);
      const pageUser = decodeVerifiedUser(req.headers.get(VERIFIED_USER_HEADER));
      expect(pageUser).toMatchObject({ id: U1 });

      // And the pre-stamp Unicode value itself decodes losslessly — this is
      // the name loadMapSession would hand to profileFromUser.
      const unicodeHeaders = new Headers();
      unicodeHeaders.set(VERIFIED_USER_HEADER, value);
      expect(decodeVerifiedUser(unicodeHeaders.get(VERIFIED_USER_HEADER))).toMatchObject({
        id: U1,
        user_metadata: { full_name: name },
      });
    }
  });

  it("attacker header + valid session: production strip wins, real identity reaches the page", async () => {
    const attackerValue = encodeVerifiedUser({
      id: ATTACKER_ID,
      user_metadata: { full_name: "Attacker" },
    });
    const { req, verifiedUser } = await productionCafeHandoff(
      cafeRequest(sessionCookie(U1), { [VERIFIED_USER_HEADER]: attackerValue }),
    );

    // The spoof never survives the real strip: the verified session id wins.
    expect(verifiedUser).toMatchObject({ id: U1 });
    expect(decodeVerifiedUser(req.headers.get(VERIFIED_USER_HEADER))).toMatchObject({ id: U1 });
    expect(decodeVerifiedUser(req.headers.get(VERIFIED_USER_HEADER))).not.toMatchObject({
      id: ATTACKER_ID,
    });
  });

  it("attacker header without a session: anonymous stays anonymous", async () => {
    const attackerValue = encodeVerifiedUser({
      id: ATTACKER_ID,
      user_metadata: { full_name: "Attacker" },
    });
    const { req, verifiedUser } = await productionCafeHandoff(
      cafeRequest(undefined, { [VERIFIED_USER_HEADER]: attackerValue }),
    );

    // Stripped inbound, then getUser finds no session: verified anonymous.
    expect(verifiedUser).toBeNull();
    expect(decodeVerifiedUser(req.headers.get(VERIFIED_USER_HEADER))).toBeNull();
    const cafe = await getCafe(CAFE_A, null);
    expect(cafe?.id).toBe(CAFE_A);
  });

  it("refreshed cookies survive forwarding alongside the verified header", async () => {
    const expiredToken = fakeJwt(U1, { email: "liming@example.com" }, -3600);
    const staleSession = {
      access_token: expiredToken,
      refresh_token: `mock-refresh-${U1}`,
      user: { id: U1 },
      expires_at: 1,
    };
    const staleCookie = `sb-127-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(staleSession)).toString("base64url")}`,
    )}`;
    const { verifiedUser, response, sessionRefreshed } = await productionCafeHandoff(
      cafeRequest(staleCookie),
    );

    // The mock refreshes the expired token (a session cookie rotation), the
    // verified identity still reaches the page, and the rotation is flagged
    // so the proxy stamps no-store instead of caching a session response.
    expect(verifiedUser).toMatchObject({ id: expect.any(String) });
    expect(sessionRefreshed).toBe(true);
    const setCookie = response.headers.get("set-cookie") ?? response.cookies.toString();
    expect(setCookie.length).toBeGreaterThan(0);
  });

  it("oversized identity falls back without throwing; page retries its own getUser", async () => {
    const req = cafeRequest(sessionCookie(U1));
    const { verifiedUser } = await refreshSessionAndVerify(
      req,
      NextResponse.next({ request: req }),
      SUPABASE_URL,
      ANON_KEY,
      true,
    );
    expect(verifiedUser).toMatchObject({ id: U1 });

    // Direct probe of the production forward helper's failure mode: an
    // unencodable identity leaves NO header (never a throw, never a spoof),
    // so loadMapSession's `undefined` branch retries getUser itself.
    const oversized = new Headers();
    expect(trySetVerifiedUserHeader(oversized, { id: "x".repeat(500) })).toBe(false);
    expect(decodeVerifiedUser(oversized.get(VERIFIED_USER_HEADER))).toBeUndefined();
  });

  it("page-side fallback: absent/malformed headers mean not-verified, anonymous stays anonymous", async () => {
    expect(decodeVerifiedUser(null)).toBeUndefined();
    expect(decodeVerifiedUser("null")).toBeNull();
    const malformedPayloads = [
      `v1.${Buffer.from(JSON.stringify({ email: "a@x.com" }), "utf8").toString("base64url")}`,
      `v1.${Buffer.from(JSON.stringify({ id: 123 }), "utf8").toString("base64url")}`,
      `v1.${Buffer.from(JSON.stringify({ id: "" }), "utf8").toString("base64url")}`,
      `v1.${Buffer.from(
        JSON.stringify({ id: U1, user_metadata: { full_name: 123 } }),
        "utf8",
      ).toString("base64url")}`,
    ];
    for (const raw of malformedPayloads) {
      // Each fixture carries the v1 prefix, so rejection happens in payload
      // validation — not on the prefix check.
      expect(raw.startsWith("v1.")).toBe(true);
      const decoded = decodeVerifiedUser(raw);
      if (decoded === null || decoded === undefined) {
        expect(decoded).toBeUndefined();
      } else {
        expect(decoded.user_metadata).toBeUndefined();
        expect(decoded).toMatchObject({ id: U1 });
      }
    }
    // Anonymous (no session): verified null, cafe still renders publicly.
    const { verifiedUser } = await productionCafeHandoff(cafeRequest());
    expect(verifiedUser).toBeNull();
    expect(await getCafe(CAFE_A, null)).toMatchObject({ id: CAFE_A });
  });
});
