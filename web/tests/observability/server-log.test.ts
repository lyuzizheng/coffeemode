import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REQUEST_ID_HEADER,
  getRequestId,
  isValidRequestId,
  logError,
  logWarn,
} from "@/lib/observability/server-log";

function loggedLine(): Record<string, unknown> {
  const spy = vi.mocked(console.error);
  expect(spy).toHaveBeenCalledTimes(1);
  const [raw] = spy.mock.calls[0];
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("isValidRequestId", () => {
  it("accepts UUIDs and rejects forged values", () => {
    expect(isValidRequestId(crypto.randomUUID())).toBe(true);
    expect(isValidRequestId("not-a-uuid")).toBe(false);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
  });
});

describe("getRequestId", () => {
  it("reuses a valid inbound id", () => {
    const id = crypto.randomUUID();
    const req = new Request("http://localhost/api/cafes", {
      headers: { [REQUEST_ID_HEADER]: id },
    });
    expect(getRequestId(req)).toBe(id);
  });

  it("generates a fresh id when missing or forged", () => {
    const missing = getRequestId(new Request("http://localhost/api/health"));
    expect(isValidRequestId(missing)).toBe(true);
    const forged = getRequestId(
      new Request("http://localhost/api/cafes", {
        headers: { [REQUEST_ID_HEADER]: "attacker-chosen" },
      }),
    );
    expect(isValidRequestId(forged)).toBe(true);
    expect(forged).not.toBe("attacker-chosen");
  });
});

describe("logError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(console.error).mockClear();
  });

  it("logs one JSON line joining the access log on request_id", () => {
    const err = new Error("Postgres is down");
    logError({
      route: "GET /api/cafes",
      requestId: "req-1",
      error: err,
      status: 500,
    });

    const line = loggedLine();
    expect(line).toMatchObject({
      type: "error",
      request_id: "req-1",
      route: "GET /api/cafes",
      status: 500,
      error: "Postgres is down",
    });
    expect(typeof line.stack).toBe("string");
  });

  it("resolves request_id from request headers, reusing a valid inbound id", () => {
    const id = crypto.randomUUID();
    const req = new Request("http://localhost/api/cafes", {
      headers: { [REQUEST_ID_HEADER]: id },
    });
    logError({ route: "GET /api/cafes", request: req, error: new Error("boom") });

    expect(loggedLine()).toMatchObject({ request_id: id });
  });

  it("regenerates request_id from request headers when forged", () => {
    const req = new Request("http://localhost/api/cafes", {
      headers: { [REQUEST_ID_HEADER]: "attacker-chosen" },
    });
    logError({ route: "GET /api/cafes", request: req, error: new Error("boom") });

    const line = loggedLine();
    expect(line.request_id).not.toBe("attacker-chosen");
    expect(isValidRequestId(line.request_id)).toBe(true);
  });

  it("prefers an explicit requestId over request headers", () => {
    const req = new Request("http://localhost/api/cafes", {
      headers: { [REQUEST_ID_HEADER]: crypto.randomUUID() },
    });
    logError({ route: "GET /api/cafes", request: req, requestId: "explicit", error: "x" });

    expect(loggedLine()).toMatchObject({ request_id: "explicit" });
  });

  it("nulls request_id without request context and omits status", () => {
    logError({ route: "postgres pool", error: new Error("boom") });

    const line = loggedLine();
    expect(line.request_id).toBeNull();
    expect(line).not.toHaveProperty("status");
  });

  it("serializes non-Error input without leaking structure", () => {
    logError({ route: "poi-service", error: { status: 500 } });

    const line = loggedLine();
    expect(line.error).toBe('{"status":500}');
  });

  it("never logs user content passed by mistake beyond a capped string", () => {
    const bigBody = "x".repeat(5000);
    logError({ route: "POST /api/cafes", error: bigBody });

    const line = loggedLine();
    expect((line.error as string).length).toBeLessThanOrEqual(1001);
  });
});

describe("code field (spec 0011 D7)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(console.error).mockClear();
    vi.mocked(console.warn).mockClear();
  });

  it("emits code on error lines when status is >= 400", () => {
    logError({ route: "POST /api/checkins", error: "conflict", status: 409, code: "duplicate_checkin" });
    expect(loggedLine()).toMatchObject({ code: "duplicate_checkin", status: 409 });
  });

  it("suppresses code when the status is below 400", () => {
    logError({ route: "GET /api/cafes", error: "odd", status: 200, code: "not_found" });
    expect(loggedLine()).not.toHaveProperty("code");
  });

  it("logWarn writes a warn line with the same shape via console.warn", () => {
    logWarn({
      route: "POST /api/cafes",
      requestId: "req-9",
      error: "cross-origin request forbidden",
      status: 403,
      code: "forbidden_origin",
    });

    expect(console.error).not.toHaveBeenCalled();
    const spy = vi.mocked(console.warn);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      type: "warn",
      request_id: "req-9",
      route: "POST /api/cafes",
      status: 403,
      code: "forbidden_origin",
      error: "cross-origin request forbidden",
    });
  });
});
