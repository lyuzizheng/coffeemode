import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSinkThrottleForTests,
  shipApiErrorLine,
} from "@/lib/observability/api-error-sink";
import { logError } from "@/lib/observability/server-log";

const INGEST_URL = "https://s2769809.us-west-2a.betterstackdata.com/";

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("shipApiErrorLine", () => {
  beforeEach(() => {
    _resetSinkThrottleForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.BETTER_STACK_ERRORS_INGEST_URL;
    delete process.env.BETTER_STACK_ERRORS_INGEST_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.BETTER_STACK_ERRORS_INGEST_URL;
    delete process.env.BETTER_STACK_ERRORS_INGEST_TOKEN;
  });

  it("is a no-op when the source is not configured", () => {
    const fetchMock = stubFetch();

    shipApiErrorLine({ type: "error", route: "GET /api/cafes", status: 500 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the line to the configured source with the bearer token", () => {
    process.env.BETTER_STACK_ERRORS_INGEST_URL = INGEST_URL;
    process.env.BETTER_STACK_ERRORS_INGEST_TOKEN = "ingest-token";
    const fetchMock = stubFetch();
    const line = {
      type: "error",
      request_id: "req-1",
      route: "GET /api/cafes",
      status: 500,
      code: "internal_error",
      error: "Postgres is down",
    };

    shipApiErrorLine(line);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INGEST_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer ingest-token",
    );
    expect(JSON.parse(init.body as string)).toEqual(line);
  });

  it("ships without an Authorization header when only the host is set", () => {
    process.env.BETTER_STACK_ERRORS_INGEST_URL = INGEST_URL;
    const fetchMock = stubFetch();

    shipApiErrorLine({ type: "warn", route: "auth", status: 401 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("never throws on ingest failure and reports it once per throttle window", async () => {
    process.env.BETTER_STACK_ERRORS_INGEST_URL = INGEST_URL;
    // A promise the test owns: rejecting it after the calls, then awaiting the
    // same promise, guarantees the sink's `.catch` ran — no timer guessing.
    const { promise, reject } = Promise.withResolvers<Response>();
    const fetchMock = vi.fn().mockReturnValue(promise);
    vi.stubGlobal("fetch", fetchMock);

    expect(() => {
      shipApiErrorLine({ type: "error", route: "GET /api/cafes", status: 500 });
      shipApiErrorLine({ type: "error", route: "GET /api/cafes", status: 500 });
    }).not.toThrow();
    reject(new Error("ECONNREFUSED"));
    await promise.catch(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
    const [raw] = vi.mocked(console.warn).mock.calls[0];
    expect(JSON.parse(raw as string)).toMatchObject({
      type: "warn",
      route: "api-error-sink",
      error: "ECONNREFUSED",
    });
  });

  it("never throws when the line cannot be serialized", () => {
    process.env.BETTER_STACK_ERRORS_INGEST_URL = INGEST_URL;
    const fetchMock = stubFetch();
    const circular: Record<string, unknown> = { type: "error", route: "GET /api/cafes" };
    circular.self = circular;

    expect(() => shipApiErrorLine(circular)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
  });
});

describe("logError → coffeemode-api-errors source", () => {
  beforeEach(() => {
    _resetSinkThrottleForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.BETTER_STACK_ERRORS_INGEST_URL = INGEST_URL;
    process.env.BETTER_STACK_ERRORS_INGEST_TOKEN = "ingest-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.BETTER_STACK_ERRORS_INGEST_URL;
    delete process.env.BETTER_STACK_ERRORS_INGEST_TOKEN;
  });

  it("ships the same line it writes to stdout", () => {
    const fetchMock = stubFetch();

    logError({
      route: "GET /api/cafes",
      requestId: "req-1",
      error: new Error("Postgres is down"),
      status: 500,
      code: "internal_error",
    });

    const [raw] = vi.mocked(console.error).mock.calls[0];
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(JSON.parse(raw as string));
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: "error",
      request_id: "req-1",
      route: "GET /api/cafes",
      status: 500,
      code: "internal_error",
    });
  });
});
