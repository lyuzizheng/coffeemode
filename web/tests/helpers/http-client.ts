import { vi } from "vitest";

/**
 * Pure HTTP API simulation base for the multi-user lifecycle suite
 * (BRAWUKA-146, Stage 1). Every helper here works the standard
 * `Request -> route handler -> Response` path — no direct `lib/db/*`
 * calls, no "privileged" short-circuits.
 *
 * Every route handler under `web/app/api/**` authenticates through ONE seam,
 * `getCurrentUser()` from `@/lib/auth/get-user`. This module owns a mutable
 * session pointer (`httpAuthState`) that the mocked seam reads, so Stage-2
 * tests switch users A/B/C/D per request without touching auth internals.
 *
 * REQUIRED one-time wiring in the consuming test file (top-level, hoisted):
 *
 * ```ts
 * import { httpAuthState } from "../helpers/http-client";
 *
 * vi.mock("@/lib/auth/get-user", () => ({
 *   getCurrentUser: vi.fn(async () =>
 *     httpAuthState.userId ? { id: httpAuthState.userId } : null,
 *   ),
 * }));
 * ```
 *
 * The mock MUST live in the test file, not here: `vi.mock` factories are
 * hoisted per importing file, and a mock installed from this helper would
 * silently override the per-file `supabase-server` mocks that the existing
 * 80+ unit tests rely on. `httpAuthMockFactory()` below is the ready-made
 * factory for that one-line `vi.mock` call.
 *
 * Session usage (sequential awaits — each session call restores the
 * previous user, so A/B/C/D interleave safely within one file):
 *
 * ```ts
 * import { GET as listCafes, POST as createCafe } from "@/app/api/cafes/route";
 *
 * const asAlice = createHttpSession(ALICE_ID);
 * const { status, body } = await asAlice.post(createCafe, "/api/cafes", {
 *   json: { name: "Caracara", lat: 1.2789, lng: 103.8425, checkin: { ... } },
 * });
 * ```
 *
 * Origin note: requests carry NO `Origin`/`Referer` header by default, which
 * `requireSameOrigin` treats as a non-browser API client (allowed). Pass
 * `origin` explicitly when a test needs to exercise the 403 cross-origin
 * path.
 */

// ---------------------------------------------------------------------------
// Session state (the single seam the mocked `getCurrentUser` reads)
// ---------------------------------------------------------------------------

/** Mutable session pointer for HTTP-simulated callers. `null` = anonymous. */
export const httpAuthState: { userId: string | null } = { userId: null };

/** Switch the simulated session; returns the previous user id. */
export function setHttpUser(userId: string | null): string | null {
  const previous = httpAuthState.userId;
  httpAuthState.userId = userId;
  return previous;
}

/**
 * Ready-made `vi.mock("@/lib/auth/get-user", ...)` factory. Reads
 * `httpAuthState` at call time so `setHttpUser` / `runAsHttpUser` /
 * `createHttpSession` take effect per request.
 */
export function httpAuthMockFactory(): {
  getCurrentUser: () => Promise<{ id: string } | null>;
} {
  return {
    getCurrentUser: vi.fn(async () =>
      httpAuthState.userId ? { id: httpAuthState.userId } : null,
    ),
  };
}

/**
 * Run `fn` as `userId`, restoring the previous session afterwards — the
 * primitive that makes multi-user interleaving (A/B/C/D) safe under
 * sequential awaits.
 */
export async function runAsHttpUser<T>(
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = setHttpUser(userId);
  try {
    return await fn();
  } finally {
    setHttpUser(previous);
  }
}

// ---------------------------------------------------------------------------
// Request building (real Headers / Cookies / query, standard Request)
// ---------------------------------------------------------------------------

export const HTTP_TEST_BASE_URL = "https://localhost";

export interface HttpRequestOptions {
  /** HTTP method. Defaults to `"GET"`. */
  method?: string;
  /** Path, e.g. `"/api/cafes"`. Query may be inline or via `query`. */
  path: string;
  /** Extra query params, merged over any inline `?…` on `path`. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON body (sets `Content-Type: application/json`). */
  json?: unknown;
  /** Multipart body (sets its own content type via FormData). */
  form?: FormData;
  /** Raw body for byte-level cases (e.g. WebP payloads). */
  body?: BodyInit | null;
  /** Extra headers. `cookie` here is overridden by `cookies` below. */
  headers?: Record<string, string>;
  /** Cookies, serialized into a single `Cookie` header. */
  cookies?: Record<string, string> | string;
  /** Shortcut for the `User-Agent` header (rate-limit identity). */
  userAgent?: string;
  /** Shortcut for `X-Forwarded-For` (anonymous rate-limit identity). */
  ip?: string;
  /** Sets `Origin` (default: absent = non-browser client, allowed). */
  origin?: string;
  /** Sets `Referer` (default: absent). */
  referer?: string;
}

/** Build a standard `Request` exactly as a real client would send it. */
export function buildHttpRequest(options: HttpRequestOptions): Request {
  const {
    method = "GET",
    path,
    query,
    json,
    form,
    body,
    headers = {},
    cookies,
    userAgent,
    ip,
    origin,
    referer,
  } = options;

  const url = new URL(path, HTTP_TEST_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  const finalHeaders = new Headers(headers);
  if (userAgent !== undefined) finalHeaders.set("user-agent", userAgent);
  if (ip !== undefined) finalHeaders.set("x-forwarded-for", ip);
  if (origin !== undefined) finalHeaders.set("origin", origin);
  if (referer !== undefined) finalHeaders.set("referer", referer);
  if (cookies !== undefined) {
    finalHeaders.set(
      "cookie",
      typeof cookies === "string"
        ? cookies
        : Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
    );
  }
  let finalBody: BodyInit | null | undefined;
  if (json !== undefined) {
    if (!finalHeaders.has("content-type")) {
      finalHeaders.set("content-type", "application/json");
    }
    finalBody = JSON.stringify(json);
  } else if (form !== undefined) {
    finalBody = form;
  } else if (body !== undefined) {
    finalBody = body;
  }

  return new Request(url.toString(), {
    method,
    headers: finalHeaders,
    body: finalBody ?? null,
  });
}

// ---------------------------------------------------------------------------
// Handler invocation + Response parsing
// ---------------------------------------------------------------------------

/** Any Next.js route handler: `(request, { params }) => Response`. */
export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/**
 * Invoke a route handler through the standard Request -> Response flow.
 * `params` feeds dynamic segments (`[id]`); single-arg handlers (no
 * segments) safely ignore the context.
 */
export async function callRoute(
  handler: RouteHandler,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  return handler(request, { params: Promise.resolve(params) });
}

export interface ParsedApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or `null` when the response has no JSON body. */
  body: T | null;
  /** Raw text (useful when `body` is null or on parse failure). */
  text: string;
}

/** Read a route `Response` fully: status + headers + parsed JSON body. */
export async function readJsonResponse<T = unknown>(
  response: Response,
): Promise<ParsedApiResponse<T>> {
  const text = await response.text();
  let body: T | null = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: response.status, headers: response.headers, body, text };
}

export interface RouteCallOptions extends HttpRequestOptions {
  /** Dynamic route segments, e.g. `{ id: cafeId }` for `[id]` routes. */
  params?: Record<string, string>;
}

/**
 * One-shot helper for the common case: build the Request, invoke the
 * handler, parse the Response. Returns status + typed JSON body.
 */
export async function callRouteJson<T = unknown>(
  handler: RouteHandler,
  options: RouteCallOptions,
): Promise<ParsedApiResponse<T>> {
  const { params, ...requestOptions } = options;
  const response = await callRoute(
    handler,
    buildHttpRequest(requestOptions),
    params ?? {},
  );
  return readJsonResponse<T>(response);
}

// ---------------------------------------------------------------------------
// Bound multi-user sessions (Users A/B/C/D ergonomics for Stage 2)
// ---------------------------------------------------------------------------

/** Options for the `HttpSession` verb shortcuts: everything except `path`/`method`. */
export type VerbCallOptions = Omit<RouteCallOptions, "path" | "method">;

export interface HttpSession {
  readonly userId: string | null;
  /** Run `fn` with this session active (restores the previous one after). */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Raw call: full `HttpRequestOptions` + optional dynamic `params`. */
  call<T>(handler: RouteHandler, options: RouteCallOptions): Promise<ParsedApiResponse<T>>;
  get<T>(handler: RouteHandler, path: string, options?: VerbCallOptions): Promise<ParsedApiResponse<T>>;
  post<T>(handler: RouteHandler, path: string, options?: VerbCallOptions): Promise<ParsedApiResponse<T>>;
  patch<T>(handler: RouteHandler, path: string, options?: VerbCallOptions): Promise<ParsedApiResponse<T>>;
  put<T>(handler: RouteHandler, path: string, options?: VerbCallOptions): Promise<ParsedApiResponse<T>>;
  delete<T>(handler: RouteHandler, path: string, options?: VerbCallOptions): Promise<ParsedApiResponse<T>>;
}

/**
 * Bind a user id to convenience HTTP verbs. Every call runs under
 * `runAsHttpUser`, so sessions A/B/C/D interleave safely.
 * `userId: null` = anonymous visitor (User D style read-only probing).
 */
export function createHttpSession(userId: string | null): HttpSession {
  const run = <T>(fn: () => Promise<T>): Promise<T> => runAsHttpUser(userId, fn);
  const call = <T>(
    handler: RouteHandler,
    options: RouteCallOptions,
  ): Promise<ParsedApiResponse<T>> => run(() => callRouteJson<T>(handler, options));
  const withMethod =
    (method: string) =>
    <T>(
      handler: RouteHandler,
      path: string,
      options: VerbCallOptions = {},
    ): Promise<ParsedApiResponse<T>> =>
      call<T>(handler, { ...options, path, method });

  return {
    userId,
    run,
    call,
    get: withMethod("GET"),
    post: withMethod("POST"),
    patch: withMethod("PATCH"),
    put: withMethod("PUT"),
    delete: withMethod("DELETE"),
  };
}

/** Anonymous visitor session (no auth) — the User-D read-only perspective. */
export function createAnonymousSession(): HttpSession {
  return createHttpSession(null);
}
