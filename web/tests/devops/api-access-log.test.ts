/**
 * @vitest-environment node
 * API completion access-log contract (BRAWUKA-729, spec 0011 D7).
 *
 * The proxy runs before routing, so its `NextResponse.next()` is always 200 —
 * it cannot report the route's real status. The route boundary (`apiRoute`)
 * owns the completion access line instead: one line per request carrying the
 * produced status, the envelope `code` on ≥400, and the full guard+handler
 * elapsed time. The proxy stays silent on `/api/*` so no duplicate success
 * entry exists; non-API traffic keeps its proxy line.
 *
 * Failure modes pinned here, then implemented:
 * 1. 2xx → exactly one line, status 200, no `code`, real request_id/method/path.
 * 2. Handler validation error → status 400 + `code: "invalid_request"`.
 * 3. Guard auth rejection → status 401 + `code: "unauthorized"`.
 * 4. Origin rejection → status 403 + `code: "forbidden_origin"`.
 * 5. Rate-limit denial → status 429 + `code: "rate_limited"`.
 * 6. Handler throw → status 500 + `code: "internal_error"`.
 * 7. Slow handler → `duration_ms` covers handler latency.
 * 8. Query strings never reach `path` (no-query logging policy, BRAWUKA-282).
 * 9. `/api/*` through the proxy emits no access line (no duplicate).
 * 10. Non-API traffic through the proxy still emits its access line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { registerLineSink } from "@shared/log";
import { apiRoute } from "@/lib/api/route";
import { apiError } from "@/lib/api/response";
import { rateLimiter } from "@/lib/rate-limit";
import { proxy } from "@/proxy";
import { getCurrentUser } from "@/lib/auth/get-user";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

/**
 * Build a canonical `NextRequest` and program the auth seam the same way the
 * HTTP suites do (`setCurrentTestUser`): without the mock, `getCurrentUser()`
 * hits Supabase instead of the test identity.
 */
function routeRequest(
  method: string,
  path: string,
  requestId: string,
  headers: Record<string, string> = {},
  session: { id: string } | null = null,
): NextRequest {
  vi.mocked(getCurrentUser).mockResolvedValue(session);
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { origin: "http://localhost:3000", "x-request-id": requestId, ...headers },
  });
}

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

type AccessLine = Record<string, unknown>;

let captured: AccessLine[];

function accessLinesFor(requestId: string): AccessLine[] {
  return captured.filter(
    (line) => line.type === "access" && line.request_id === requestId,
  );
}


// Real 60ms delay: duration_ms is measured against the platform clock, so
// fake timers cannot advance it. One latency assertion, paid once per run.
const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

describeIntegration("integration — api completion access log (BRAWUKA-729)", () => {
  beforeEach(() => {
    captured = [];
    registerLineSink((line) => {
      captured.push(line);
    });
    rateLimiter.reset();
  });

  afterEach(() => {
    registerLineSink(null);
  });

  it("emits one completion line for a 2xx response", async () => {
    const requestId = randomUUID();
    const GET = apiRoute(
      { bucket: "cafes-read", route: "GET /api/test-access" },
      async () => NextResponse.json({ ok: true }),
    );

    const response = await GET(routeRequest("GET", "/api/test-access?lat=1", requestId));

    expect(response.status).toBe(200);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "access",
      request_id: requestId,
      route: "GET /api/test-access",
      method: "GET",
      path: "/api/test-access",
      status: 200,
    });
    expect(lines[0]).not.toHaveProperty("code");
    expect(typeof lines[0]?.duration_ms).toBe("number");
  });

  it("reports handler validation errors with status and code", async () => {
    const requestId = randomUUID();
    const GET = apiRoute(
      { bucket: "cafes-read", route: "GET /api/test-access" },
      async (_request, ctx) =>
        apiError("invalid_request", "id must be a UUID", {
          status: 400,
          requestId: ctx.requestId,
        }),
    );

    const response = await GET(routeRequest("GET", "/api/cafes/not-a-uuid", requestId));

    expect(response.status).toBe(400);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("reports guard auth rejections", async () => {
    const requestId = randomUUID();
    const GET = apiRoute(
      { bucket: "cafes-read", auth: "required", route: "GET /api/test-access" },
      async () => NextResponse.json({ ok: true }),
    );

    const response = await GET(routeRequest("GET", "/api/test-access", requestId));

    expect(response.status).toBe(401);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("reports origin rejections", async () => {
    const requestId = randomUUID();
    const POST = apiRoute(
      {
        bucket: "cafes-write",
        origin: true,
        route: "POST /api/test-access",
      },
      async () => NextResponse.json({ ok: true }),
    );

    const response = await POST(
      routeRequest("POST", "/api/test-access", requestId, {
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 403, code: "forbidden_origin" });
  });

  it("reports rate-limit denials with status and code", async () => {
    const GET = apiRoute(
      { bucket: "cafes-read", route: "GET /api/test-access" },
      async () => NextResponse.json({ ok: true }),
    );

    let denied: NextResponse | null = null;
    for (let i = 0; i < 31; i += 1) {
      const response = (await GET(
        routeRequest("GET", "/api/test-access", randomUUID()),
      )) as NextResponse;
      if (response.status === 429) denied = response;
    }

    expect(denied?.status).toBe(429);
    const deniedLines = captured.filter(
      (line) => line.type === "access" && line.status === 429,
    );
    expect(deniedLines).toHaveLength(1);
    expect(deniedLines[0]).toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("reports handler throws as 500 internal_error", async () => {
    const requestId = randomUUID();
    const GET = apiRoute(
      { bucket: "cafes-read", route: "GET /api/test-access" },
      async () => {
        throw new Error("boom");
      },
    );

    const response = await GET(routeRequest("GET", "/api/test-access", requestId));

    expect(response.status).toBe(500);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 500, code: "internal_error" });
  });

  it("measures handler latency in duration_ms", async () => {
    const requestId = randomUUID();
    const GET = apiRoute(
      { bucket: "cafes-read", route: "GET /api/test-access" },
      async () => {
        await sleep(60);
        return NextResponse.json({ ok: true });
      },
    );

    await GET(routeRequest("GET", "/api/test-access", requestId));

    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.duration_ms as number).toBeGreaterThanOrEqual(50);
  });

  it("emits no proxy access line for /api/* requests", async () => {
    const requestId = randomUUID();

    const response = await proxy(
      new NextRequest("http://localhost:3000/api/cafes/not-a-uuid", {
        headers: { "x-request-id": requestId },
      }),
    );

    expect(response.status).toBe(200);
    expect(accessLinesFor(requestId)).toHaveLength(0);
  });

  it("keeps the proxy access line for non-API traffic", async () => {
    const requestId = randomUUID();

    const response = await proxy(
      new NextRequest(`http://localhost:3000/cafes/${randomUUID()}`, {
        headers: { "x-request-id": requestId },
      }),
    );

    expect(response.status).toBe(200);
    const lines = accessLinesFor(requestId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "access", status: 200 });
  });
});
