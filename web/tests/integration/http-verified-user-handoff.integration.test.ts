/**
 * @vitest-environment node
 *
 * Proxy → page verified-user boundary (BRAWUKA-723 / BRAWUKA-750).
 *
 * Unlike the codec unit suite (`verified-user-handoff.test.ts`), every
 * transport case here drives the REAL `proxy()` entry against the compose
 * supabase-mock over HTTP and reads the identity back from the middleware
 * forwarded headers (`x-middleware-request-x-verified-user`) — the exact
 * bytes Next.js hands the page. The suite never reconstructs proxy routing:
 * deleting production stripping or header forwarding breaks these tests.
 * That is the point.
 *
 * The mock's /auth/v1/user echoes the JWT's user_metadata claims (like real
 * GoTrue), so Unicode provider names travel the production verify → forward
 * path. The page-side consumer (`loadMapSession`/`loadMapEntry`) is then
 * exercised with forwarded, absent, malformed, and anonymous values with
 * page-side getUser call counting, and the real page path
 * (`generateMetadata` + the viewer-scoped `loadCafe` data path) is
 * exercised for Chinese and emoji identities — title/OG/canonical plus
 * the public shell props, all resolved under the forwarded viewer.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCafe } from "@/lib/db/cafes";
import { proxy } from "@/proxy";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
  encodeVerifiedUser,
} from "@/lib/auth/verified-user";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
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

// Page-side header state for the loadMapSession consumer cases: the real
// proxy() response yields the forwarded value, which is then fed to a
// freshly imported page loader through this mock (next/headers has no
// request scope outside a real render).
const pageHeaderState = vi.hoisted(() => ({ present: false, raw: "" }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (pageHeaderState.present) h.set(VERIFIED_USER_HEADER, pageHeaderState.raw);
    return h;
  }),
  cookies: vi.fn(async () => ({
    getAll: () => [],
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

// Page-side recovered identity for the oversized-fallback case: when the
// proxy forwards nothing, the consumer's own getUser() identifies the
// viewer. Each recovery case programs this; the counter above proves the
// retry happened exactly once.
const pageRecoveryState = vi.hoisted(() => ({ user: null as null | { id: string } }));

// Page-side getUser call counter: the loader's own fallback is stubbed at
// the supabase-server boundary so each case asserts exactly how many
// network validations the consumer needed.
const pageAuthState = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/auth/supabase-server", () => ({
  isAuthConfigured: () => true,
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        pageAuthState.calls += 1;
        return { data: { user: pageRecoveryState.user } };
      }),
    },
  })),
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

// The mock echoes the JWT's user_metadata claims on /auth/v1/user (like
// real GoTrue), so metadata travels the production verify → forward path.
function sessionCookie(uid: string, userMetadata?: Record<string, unknown>): string {
  const token = fakeJwt(uid, {
    email: "liming@example.com",
    ...(userMetadata ? { user_metadata: userMetadata } : {}),
  });
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

/** The exact bytes Next.js would hand the page for this response. */
function forwardedRaw(response: Response): string | null {
  return response.headers.get("x-middleware-request-x-verified-user");
}

function overrideHeaders(response: Response): string {
  return response.headers.get("x-middleware-override-headers") ?? "";
}

/** Fresh page loader (React cache() otherwise pins the first case's result). */
async function freshLoadMapSession() {
  vi.resetModules();
  pageAuthState.calls = 0;
  pageRecoveryState.user = null;
  return (await import("@/lib/discovery/map-entry")).loadMapSession;
}

async function freshLoadMapEntry() {
  return (await import("@/lib/discovery/map-entry")).loadMapEntry;
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
    const response = await proxy(cafeRequest(sessionCookie(U1)));
    expect(response.status).toBe(200);

    // The proxy verified the session: it forwards the identity on the exact
    // bytes the page reads.
    expect(overrideHeaders(response)).toContain("x-verified-user");
    const pageUser = decodeVerifiedUser(forwardedRaw(response));
    expect(pageUser).toMatchObject({ id: U1 });
    if (pageUser === null || pageUser === undefined) throw new Error("page identity missing");

    // And the cafe page's own query renders for that viewer.
    const cafe = await getCafe(CAFE_A, pageUser.id);
    expect(cafe?.id).toBe(CAFE_A);
  });

  it("Unicode display names survive the real forward path (ByteString regression)", async () => {
    for (const name of ["李明", "☕ Nomad", "王芳 ☕"]) {
      // The provider name enters via the auth response (mock echoes the
      // JWT claims like GoTrue) and must exit the real forward path intact.
      const response = await proxy(cafeRequest(sessionCookie(U1, { full_name: name })));
      expect(overrideHeaders(response)).toContain("x-verified-user");
      expect(decodeVerifiedUser(forwardedRaw(response))).toMatchObject({
        id: U1,
        user_metadata: { full_name: name },
      });
    }

    // The page consumer resolves the forwarded Unicode identity to the
    // authenticated shell it renders — no page-side re-verification.
    const response = await proxy(cafeRequest(sessionCookie(U1, { full_name: "李明" })));
    const raw = forwardedRaw(response);
    expect(raw).not.toBeNull();
    pageHeaderState.present = true;
    pageHeaderState.raw = raw ?? "";
    const loadMapSession = await freshLoadMapSession();
    const session = await loadMapSession();
    expect(session.user).toMatchObject({ id: U1, user_metadata: { full_name: "李明" } });
    expect(pageAuthState.calls).toBe(0);
    const loadMapEntry = await freshLoadMapEntry();
    const entry = await loadMapEntry({ lat: 1.35, lng: 103.8 });
    expect(entry.isAuthenticated).toBe(true);
    // The suite's own profile row ("Boundary Nomad", N) supplies the
    // rendered initial — the point is the page consumed the forwarded
    // identity without re-verifying, not which display fallback won.
    expect(session.profile).toMatchObject({ displayName: "Boundary Nomad" });
    expect(entry.accountInitial).toBe("B");
    // The page path renders for Chinese and emoji identities: the real
    // `generateMetadata` (title/OG/canonical from the cafe row) plus the
    // page's own data path (`loadCafe` viewer lookup → `getCafe` →
    // `toPublicCafeDetail`/`publicCafeShell` props the shell renders), all
    // resolved under the forwarded viewer with zero page-side re-calls.
    // Full JSX rendering stops at next-intl's server boundary
    // (`getTranslations` needs the Next request runtime, absent in
    // vitest) — these are the real page functions, not query-only probes.
    vi.mock("next-intl/server", () => ({
      getLocale: async () => "en",
      getTranslations: async () => (key: string) => key,
    }));
    for (const name of ["李明", "☕ Nomad"]) {
      const forwarded = await proxy(cafeRequest(sessionCookie(U1, { full_name: name })));
      const rawValue = forwardedRaw(forwarded);
      expect(rawValue).not.toBeNull();
      expect(decodeVerifiedUser(rawValue)).toMatchObject({
        id: U1,
        user_metadata: { full_name: name },
      });
      pageHeaderState.present = true;
      pageHeaderState.raw = rawValue ?? "";
      vi.resetModules();
      pageAuthState.calls = 0;
      pageRecoveryState.user = null;
      const pageModule = await import("@/app/cafes/[id]/page");
      const metadata = await pageModule.generateMetadata({
        params: Promise.resolve({ id: CAFE_A }),
      });
      // Rendered cafe evidence from the real page metadata path.
      expect(metadata.title).toContain("Boundary Cafe");
      expect(metadata.alternates?.canonical).toContain(`/cafes/${CAFE_A}`);
      expect(metadata.openGraph?.title).toContain("Boundary Cafe");
      // The page's own viewer-scoped data path under the forwarded
      // identity: viewer lookup → cafe row → public shell props.
      const { loadMapSession: pageSessionLoader } = await import("@/lib/discovery/map-entry");
      const { user: viewer } = await pageSessionLoader();
      expect(viewer).toMatchObject({ id: U1, user_metadata: { full_name: name } });
      const viewerCafe = await getCafe(CAFE_A, viewer?.id);
      expect(viewerCafe?.id).toBe(CAFE_A);
      const { toPublicCafeDetail } = await import("@/lib/db/cafes");
      const { publicCafeShell } = await import("@/lib/seo");
      const attribution = toPublicCafeDetail(viewerCafe!, viewer?.id);
      expect(attribution.name).toBe("Boundary Cafe");
      expect(attribution.owned_by_viewer).toBe(true);
      const shell = publicCafeShell(viewerCafe!);
      expect(shell.actions.name).toBe("Boundary Cafe");
      expect(pageAuthState.calls).toBe(0);
    }
    vi.doUnmock("next-intl/server");
  });

  it("attacker header + valid session: production strip wins, real identity reaches the page", async () => {
    const attackerValue = encodeVerifiedUser({
      id: ATTACKER_ID,
      user_metadata: { full_name: "Attacker" },
    });
    const response = await proxy(cafeRequest(sessionCookie(U1), { [VERIFIED_USER_HEADER]: attackerValue }));

    // The spoof never survives: the forwarded bytes decode to the verified
    // session id, never the attacker id.
    expect(decodeVerifiedUser(forwardedRaw(response))).toMatchObject({ id: U1 });
    expect(decodeVerifiedUser(forwardedRaw(response))).not.toMatchObject({ id: ATTACKER_ID });
  });

  it("attacker header without a session: stripped, nothing forwarded, anonymous stays anonymous", async () => {
    const attackerValue = encodeVerifiedUser({
      id: ATTACKER_ID,
      user_metadata: { full_name: "Attacker" },
    });
    const response = await proxy(cafeRequest(undefined, { [VERIFIED_USER_HEADER]: attackerValue }));

    // Production skips verification without a session cookie, so nothing is
    // forwarded — had the strip been deleted, the forgery would ride the
    // request-header override to the page (Next forwards whatever headers
    // the pass-through request carries). Its absence IS the strip proof.
    expect(overrideHeaders(response)).not.toContain("x-verified-user");
    expect(forwardedRaw(response)).toBeNull();
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
    const response = await proxy(cafeRequest(staleCookie));

    // The mock refreshes the expired token (a session cookie rotation), the
    // verified identity still reaches the page, and the rotation is flagged
    // so the proxy stamps no-store instead of caching a session response.
    expect(decodeVerifiedUser(forwardedRaw(response))).toMatchObject({ id: expect.any(String) });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.length).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store, must-revalidate");
  });

  it("oversized valid identity falls back without throwing; page retries its own getUser", async () => {
    // A valid UUID with a Chinese display name plus one capped 2020-char
    // CJK avatar URL passes every field cap yet exceeds the 8 KiB header
    // budget (8202 chars) — the production shape that reaches the
    // forwarder's skip branch (reviewer recipe). The metadata rides the
    // JWT claims (like GoTrue returns); the ~11 KiB auth cookie is under
    // the 16 KiB Node header budget, so the real getUser() identifies the
    // viewer but the forwarder must skip the stamp.
    const bigAvatar = `https://example.com/${"李".repeat(2000)}`;
    const response = await proxy(
      cafeRequest(sessionCookie(U1, { full_name: "李明", avatar_url: bigAvatar })),
    );
    expect(response.status).toBe(200);

    // Nothing is forwarded — the override list must not name the header
    // (had stripping/forwarding been deleted, either a spoof or a throw
    // would surface here instead of silence).
    expect(overrideHeaders(response)).not.toContain("x-verified-user");
    expect(forwardedRaw(response)).toBeNull();
    expect(decodeVerifiedUser(forwardedRaw(response))).toBeUndefined();

    // The page's absent-header branch retries its own getUser() exactly
    // once and recovers the signed-in viewer — the oversized budget never
    // costs the session, only the one-request header optimization.
    pageHeaderState.present = false;
    pageRecoveryState.user = { id: U1 };
    const loadMapSession = await freshLoadMapSession();
    pageRecoveryState.user = { id: U1 };
    const session = await loadMapSession();
    expect(session.user).toMatchObject({ id: U1 });
    expect(pageAuthState.calls).toBe(1);
    expect(await getCafe(CAFE_A, U1)).toMatchObject({ id: CAFE_A });
  });

  it("page-side fallback: forwarded, absent, malformed, and anonymous values", async () => {
    // Forwarded identity: reused with zero page-side verification calls.
    pageHeaderState.present = true;
    pageHeaderState.raw = encodeVerifiedUser({ id: U1 });
    expect(decodeVerifiedUser(pageHeaderState.raw)).toMatchObject({ id: U1 });
    let loadMapSession = await freshLoadMapSession();
    let session = await loadMapSession();
    expect(session.user).toMatchObject({ id: U1 });
    expect(session.profile).toMatchObject({ displayName: "Boundary Nomad" });
    expect(pageAuthState.calls).toBe(0);

    // Absent header (every other route, or a proxy-side getUser failure):
    // the consumer verifies itself exactly once and stays anonymous here.
    pageHeaderState.present = false;
    loadMapSession = await freshLoadMapSession();
    session = await loadMapSession();
    expect(session.user).toBeNull();
    expect(pageAuthState.calls).toBe(1);

    // Malformed header: same fallback, never a trusted identity.
    pageHeaderState.present = true;
    pageHeaderState.raw = `v1.${Buffer.from(JSON.stringify({ id: 123 }), "utf8").toString("base64url")}`;
    loadMapSession = await freshLoadMapSession();
    session = await loadMapSession();
    expect(session.user).toBeNull();
    expect(pageAuthState.calls).toBe(1);

    // Verified anonymous: no verification call, anonymous view.
    pageHeaderState.present = true;
    pageHeaderState.raw = "null";
    loadMapSession = await freshLoadMapSession();
    session = await loadMapSession();
    expect(session.user).toBeNull();
    expect(pageAuthState.calls).toBe(0);
    expect(await getCafe(CAFE_A, null)).toMatchObject({ id: CAFE_A });
  });
});
