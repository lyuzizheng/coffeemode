import type pg from "pg";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { rateLimiter } from "@/lib/rate-limit";
import { createTestSessionUser, type TestSessionUser } from "./mocks";

/**
 * Multi-user HTTP API test client harness (BRAWUKA-147, Stage 1 of 3).
 *
 * Builds canonical `NextRequest` objects for direct App Router route-handler
 * invocation (`GET(req)`, `POST(req, { params })`, …) with the headers real
 * browsers send, and programs the `@/lib/auth/get-user` mock so
 * `getCurrentUser()` resolves to the client's current simulated user.
 * `NextRequest extends Request`, so both `Request`- and `NextRequest`-typed
 * handlers accept the built requests.
 *
 * Identity is programmed on the process-global mock at request-build time:
 * do NOT issue concurrent cross-identity calls (e.g. `Promise.all` across
 * users) — serialize multi-user requests to avoid identity cross-talk.
 *
 * Test files using this harness MUST hoist the auth mock at the top:
 *
 * ```ts
 * vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: vi.fn() }));
 * ```
 *
 * Without it `setCurrentTestUser` throws a descriptive error instead of
 * silently running every request as the wrong identity.
 */

export const TEST_ORIGIN = "http://localhost:3000";

export type { TestSessionUser };

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

export interface HttpRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Per-call identity override; defaults to the client's session. */
  session?: TestSessionUser | null;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Route-handler context for dynamic segments (`{ params: Promise<{ id }> }`). */
export interface RouteContext<T extends Record<string, string> = Record<string, string>> {
  params: Promise<T>;
}

export function routeParams<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

/**
 * Program the `getCurrentUser` mock to resolve to `session` (or null for a
 * guest). Called automatically before every client request; exported for
 * tests that invoke handlers with hand-built requests.
 */
export function setCurrentTestUser(session: TestSessionUser | null): void {
  const mocked = getCurrentUser as unknown as { mockResolvedValue?: (v: unknown) => void };
  if (typeof mocked.mockResolvedValue !== "function") {
    throw new Error(
      "[http-client] getCurrentUser is not mocked. Add " +
        '`vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: vi.fn() }));` ' +
        "at the top of your test file before importing route handlers.",
    );
  }
  mocked.mockResolvedValue(session ? { id: session.id } : null);
}

function appendQuery(url: string, query?: HttpRequestOptions["query"]): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url;
}

/**
 * Build a canonical route-handler `NextRequest`: absolute localhost origin URL,
 * `Origin: http://localhost:3000` (satisfies `requireSameOrigin`), JSON
 * content type for bodied methods, and a `Bearer <fakeJwt>` authorization
 * header carrying the simulated identity for debuggability. The identity
 * `getCurrentUser()` resolves to is programmed via `setCurrentTestUser`
 * (the mock seam); the header documents which user the request belongs to.
 * `NextRequest extends Request`, so both `Request`- and `NextRequest`-typed
 * route handlers accept the built requests.
 */
export function buildRouteRequest(
  method: HttpMethod,
  path: string,
  options: HttpRequestOptions = {},
): NextRequest {
  const url = appendQuery(
    path.startsWith("http") ? path : `${TEST_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`,
    options.query,
  );
  const headers: Record<string, string> = {
    origin: TEST_ORIGIN,
    ...options.headers,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] ??= "application/json";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return new NextRequest(url, { method, headers, ...(body !== undefined ? { body } : {}) });
}

/** Parse a handler `Response` preserving the real HTTP status code. */
export async function parseRouteResponse<T = unknown>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data: data as T, headers: response.headers };
}

export class ApiClient {
  private currentSession: TestSessionUser | null;

  constructor(session: TestSessionUser | null = null) {
    this.currentSession = session;
  }

  get session(): TestSessionUser | null {
    return this.currentSession;
  }

  /** Switch the simulated identity for subsequent requests (chainable). */
  withSession(session: TestSessionUser | null): this {
    this.currentSession = session;
    return this;
  }

  /** Drop identity: subsequent requests run unauthenticated (chainable). */
  asGuest(): this {
    return this.withSession(null);
  }

  /** Build a `NextRequest` for `method` + `path`, programming the auth mock. */
  raw(method: HttpMethod, path: string, options: HttpRequestOptions = {}): NextRequest {
    const session = options.session !== undefined ? options.session : this.currentSession;
    setCurrentTestUser(session);
    const request = buildRouteRequest(method, path, options);
    if (session) {
      // Document the simulated identity on the wire; the mock seam above is
      // what getCurrentUser() actually resolves.
      request.headers.set("authorization", `Bearer ${session.jwt}`);
    }
    return request;
  }

  /**
   * Invoke `handler` with a canonical request (and optional route `ctx`),
   * programming the auth mock and parsing the response. Returns
   * `{ status, data, headers }` with the handler's real HTTP status.
   * `R` accepts both `Request`- and `NextRequest`-typed handlers.
   */
  async call<T = unknown, C = undefined, R extends Request = Request>(
    handler: (request: R, ctx: C) => Promise<Response>,
    method: HttpMethod,
    path: string,
    options: HttpRequestOptions = {},
    ctx?: C,
  ): Promise<ApiResponse<T>> {
    const request = this.raw(method, path, options);
    const response = await handler(request as unknown as R, ctx as C);
    return parseRouteResponse<T>(response);
  }

  /** `GET handler(path, { query })` — no body. */
  async get<T = unknown, C = undefined, R extends Request = Request>(
    handler: (request: R, ctx: C) => Promise<Response>,
    path: string,
    options: Omit<HttpRequestOptions, "body"> = {},
    ctx?: C,
  ): Promise<ApiResponse<T>> {
    return this.call<T, C, R>(handler, "GET", path, options, ctx);
  }

  /** `POST handler(path, body)` — JSON body. */
  async post<T = unknown, C = undefined, R extends Request = Request>(
    handler: (request: R, ctx: C) => Promise<Response>,
    path: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "body"> = {},
    ctx?: C,
  ): Promise<ApiResponse<T>> {
    return this.call<T, C, R>(handler, "POST", path, { ...options, body }, ctx);
  }

  /** `PATCH handler(path, body)` — JSON body. */
  async patch<T = unknown, C = undefined, R extends Request = Request>(
    handler: (request: R, ctx: C) => Promise<Response>,
    path: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "body"> = {},
    ctx?: C,
  ): Promise<ApiResponse<T>> {
    return this.call<T, C, R>(handler, "PATCH", path, { ...options, body }, ctx);
  }

  /** `DELETE handler(path, body?)` — optional JSON body (e.g. `{ confirm }`). */
  async delete<T = unknown, C = undefined, R extends Request = Request>(
    handler: (request: R, ctx: C) => Promise<Response>,
    path: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "body"> = {},
    ctx?: C,
  ): Promise<ApiResponse<T>> {
    return this.call<T, C, R>(handler, "DELETE", path, { ...options, body }, ctx);
  }
}
export function apiClient(session: TestSessionUser | null = null): ApiClient {
  return new ApiClient(session);
}

// ——— Multi-user environment ———

export const HTTP_USER_IDS = {
  A: "c0000000-0000-4000-a000-0000000000a1",
  B: "c0000000-0000-4000-a000-0000000000a2",
  C: "c0000000-0000-4000-a000-0000000000a3",
  D: "c0000000-0000-4000-a000-0000000000a4",
} as const;

export interface HttpTestUsers {
  userA: TestSessionUser;
  userB: TestSessionUser;
  userC: TestSessionUser;
  userD: TestSessionUser;
}

/**
 * Four deterministic lifecycle users: A/B/C create cafes in different
 * cities, D is the independent visitor used for full-data reconciliation.
 * All ids are fixed UUIDs so test output stays self-describing; each user
 * carries a `fakeJwt`-shaped token for its id.
 */
export function createHttpTestUsers(): HttpTestUsers {
  const userA = createTestSessionUser({
    id: HTTP_USER_IDS.A,
    displayName: "HTTP Ann",
    currentCity: "singapore",
  });
  const userB = createTestSessionUser({
    id: HTTP_USER_IDS.B,
    displayName: "HTTP Ben",
    currentCity: "singapore",
  });
  const userC = createTestSessionUser({
    id: HTTP_USER_IDS.C,
    displayName: "HTTP Cat",
    currentCity: "tokyo",
  });
  const userD = createTestSessionUser({
    id: HTTP_USER_IDS.D,
    displayName: "HTTP Dan",
    currentCity: "taipei",
  });
  return { userA, userB, userC, userD };
}

/**
 * Insert profile rows for the four lifecycle users (upsert by id), plus any
 * slice-local `extraUsers` (e.g. pagination personas), so route handlers
 * that read `profiles` see the same identities the auth mock resolves.
 * Pair with `seedMockDataset`-style seeders for cafes/check-ins.
 */
export async function seedHttpTestUsers(
  dbClient: pg.Client,
  users: HttpTestUsers,
  extraUsers: TestSessionUser[] = [],
): Promise<void> {
  const all = [users.userA, users.userB, users.userC, users.userD, ...extraUsers];
  for (const user of all) {
    await dbClient.query(
      `insert into profiles (id, display_name, current_city)
       values ($1, $2, $3)
       on conflict (id) do update set display_name = excluded.display_name,
                                      current_city = excluded.current_city`,
      [user.id, user.displayName, user.currentCity],
    );
  }
}

/**
 * Reset rate limit counters (delete all bucket rows and in-memory state).
 * Spec 0008 §1: harness-owned rate-limit bucket reset between Acts.
 * Plain DELETE: rate_limits has no identity column and no dependents.
 */
export async function resetRateLimits(dbClient?: pg.Client): Promise<void> {
  if (dbClient) {
    await dbClient.query("delete from rate_limits");
  }
  await rateLimiter.reset();
}
