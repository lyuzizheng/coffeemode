import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRoute } from "@/lib/api/route";
import { ApiHttpError } from "@/lib/api/api-error";
import { guard } from "@/lib/api/guard";
import { logError, logWarn } from "@/lib/observability/server-log";
import { CafeExistsError, CafeHasOtherCheckinsError } from "@/lib/validation/cafe";
import { CafeNotFoundError, DuplicateCheckInError } from "@/lib/validation/checkin";
import { NextResponse } from "next/server";

vi.mock("@/lib/api/guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/guard")>();
  return { ...actual, guard: vi.fn() };
});

vi.mock("@/lib/observability/server-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/server-log")>();
  return { ...actual, logError: vi.fn(), logWarn: vi.fn() };
});

const USER = { id: "00000000-0000-4000-a000-000000000042" };

function gateOk(user: { id: string } | null = USER) {
  return { ok: true as const, user, clientId: "user:" + (user?.id ?? "anon"), route: "POST /api/x" };
}

function postRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { host: "localhost", ...headers },
  });
}

describe("apiRoute (spec 0011 D5, BRAWUKA-537)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guard).mockResolvedValue(gateOk());
  });

  it("envelopes an unknown handler throw as 500 internal_error + request_id, one logError line", async () => {
    const requestId = "11111111-2222-4333-8444-555555555555";
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => {
        throw new Error("db exploded");
      },
    );

    const res = await POST(postRequest({ "x-request-id": requestId }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "internal_error",
      request_id: requestId,
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logError).mock.calls[0][0]).toMatchObject({
      route: "POST /api/x",
      requestId,
      status: 500,
      code: "internal_error",
    });
  });

  it("envelopes a guard() internal failure (previously escaped — audit P1)", async () => {
    vi.mocked(guard).mockRejectedValueOnce(new Error("auth backend down"));
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => NextResponse.json({ unreachable: true }),
    );

    const res = await POST(postRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(typeof body.request_id).toBe("string");
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("returns a thrown ApiHttpError's code/status/details", async () => {
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => {
        throw new ApiHttpError("handle_taken", "handle is taken", { details: { handle: "x" } });
      },
    );

    const res = await POST(postRequest());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "handle_taken",
      message: "handle is taken",
      details: { handle: "x" },
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("maps registered domain errors: CafeHasOtherCheckinsError → 409 + n", async () => {
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => {
        throw new CafeHasOtherCheckinsError(3);
      },
    );

    const res = await POST(postRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    // Legacy top-level extra + details mirror (spec 0011 D2).
    expect(body).toMatchObject({ error: "cafe_has_other_checkins", n: 3, details: { n: 3 } });
    expect(logError).not.toHaveBeenCalled();
  });

  it("maps CafeExistsError extras and DuplicateCheckInError / CafeNotFoundError", async () => {
    const cases: Array<[Error, number, Record<string, unknown>]> = [
      [new CafeExistsError("cafe-1"), 409, { error: "cafe_exists", cafe_id: "cafe-1" }],
      [new CafeExistsError(null), 409, { error: "cafe_exists" }],
      [new DuplicateCheckInError("chk-9"), 409, { error: "duplicate_checkin", existing_checkin_id: "chk-9" }],
      [new CafeNotFoundError("cafe-1"), 404, { error: "not_found" }],
    ];
    for (const [thrown, status, match] of cases) {
      const POST = apiRoute(
        { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
        async () => {
          throw thrown;
        },
      );
      const res = await POST(postRequest());
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body).toMatchObject(match);
      expect(body).not.toHaveProperty("cafe_id", null);
    }
  });

  it("returns the guard's own envelope (401/429) untouched", async () => {
    vi.mocked(guard).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    });
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => NextResponse.json({ unreachable: true }),
    );

    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("rejects cross-origin mutations before guard() and logs a warn line", async () => {
    const POST = apiRoute(
      { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/x" },
      async () => NextResponse.json({ unreachable: true }),
    );

    const res = await POST(
      postRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "forbidden_origin" });
    expect(guard).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarn).mock.calls[0][0]).toMatchObject({
      route: "POST /api/x",
      status: 403,
      code: "forbidden_origin",
    });
  });

  it("resolves dynamic auth via the request (401 only when required)", async () => {
    const GET = apiRoute(
      {
        bucket: "places",
        auth: (request) => new URL(request.url).searchParams.get("source") === "google",
        route: "GET /api/x",
      },
      async (_request, ctx) => NextResponse.json({ user: ctx.user }),
    );

    vi.mocked(guard).mockImplementation(async (_req, opts) =>
      opts.requireAuth
        ? { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
        : gateOk(null),
    );

    const stored = await GET(new Request("http://localhost/api/x?source=stored"));
    expect(stored.status).toBe(200);
    const google = await GET(new Request("http://localhost/api/x?source=google"));
    expect(google.status).toBe(401);
  });

  it("awaits route params and exposes them on ctx", async () => {
    const DELETE = apiRoute<{ id: string }>(
      { bucket: "cafes-write", auth: "required", origin: true, route: "DELETE /api/x/[id]" },
      async (_request, ctx) => NextResponse.json({ id: ctx.params.id, user: ctx.user.id }),
    );

    const res = await DELETE(postRequest(), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "abc", user: USER.id });
  });
});
