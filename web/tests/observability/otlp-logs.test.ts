import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The emitter's mapping logic, driven through the module's own provider seam.
 *
 * `otlp-logs.ts` caches its `LoggerProvider` on `globalThis` so the proxy's
 * separate bundle shares one provider per process (BRAWUKA-607). Seeding that
 * slot with a recording logger exercises exactly what the module decides —
 * severity, body, attributes — without a batch timer or an HTTP round trip.
 * The wiring that builds a real provider is covered by the last block.
 */
type Emitted = {
  severityNumber: number;
  severityText: string;
  body: string;
  attributes: Record<string, string | number>;
};

const PROVIDER_KEY = "__coffeemodeOtlpLogs";

const { registerOtlpLogSink, installShutdownFlush } = await import("@/lib/observability/otlp-logs");
const { logError, logWarn, emitAccessLine, registerLineSink } = await import("@shared/log");

/** Seed the provider slot with a recorder and return what it receives. */
function capture(): Emitted[] {
  const emitted: Emitted[] = [];
  (globalThis as Record<string, unknown>)[PROVIDER_KEY] = {
    emit: (record: Emitted) => emitted.push(record),
  };
  return emitted;
}

function clearProvider(): void {
  delete (globalThis as Record<string, unknown>)[PROVIDER_KEY];
}

beforeEach(() => {
  clearProvider();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example/otlp";
  registerOtlpLogSink();
});

afterEach(() => {
  registerLineSink(null);
  clearProvider();
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
});

describe("severity mapping", () => {
  it("maps the app's three line types onto OTel severities", () => {
    const emitted = capture();

    logError({ route: "GET /api/cafes", error: "boom" });
    logWarn({ route: "GET /api/poi", error: "forbidden_origin" });
    emitAccessLine({ type: "access", method: "GET", path: "/api/cafes", status: 200 });

    // Loki derives `detected_level` from these, so a wrong number is a silently
    // wrong log level in Grafana.
    expect(emitted.map((r) => [r.severityText, r.severityNumber])).toEqual([
      ["ERROR", 17],
      ["WARN", 13],
      ["INFO", 9],
    ]);
  });

  it("falls back to INFO for an unrecognised type", () => {
    const emitted = capture();

    emitAccessLine({ type: "something-new", route: "GET /api/cafes" });

    expect(emitted[0].severityText).toBe("INFO");
    expect(emitted[0].attributes["log.type"]).toBe("something-new");
  });
});

describe("body and attributes", () => {
  it("uses the error message as the body and copies the line's fields to attributes", () => {
    const emitted = capture();

    logError({
      route: "GET /api/cafes",
      requestId: "req-abc",
      status: 500,
      code: "internal_error",
      error: new Error("upstream_error: fetch failed"),
    });

    expect(emitted[0].body).toBe("upstream_error: fetch failed");
    expect(emitted[0].attributes).toMatchObject({
      request_id: "req-abc",
      route: "GET /api/cafes",
      code: "internal_error",
      status: 500,
    });
  });

  it("carries the rate-limit fields, including the raw client_ip (BRAWUKA-607 §6 decision 5)", () => {
    const emitted = capture();

    logWarn({
      route: "GET /api/places/search",
      error: "rate_limited",
      status: 429,
      code: "rate_limited",
      clientId: "anon:abc123",
      clientIp: "203.0.113.7",
      bucket: "places",
      retryAfter: 42,
    });

    expect(emitted[0].attributes).toMatchObject({
      client_id: "anon:abc123",
      client_ip: "203.0.113.7",
      bucket: "places",
      retry_after: 42,
    });
  });

  it("omits client_ip when the caller had none, rather than emitting a null", () => {
    const emitted = capture();

    logWarn({
      route: "GET /api/places/search",
      error: "rate_limited",
      clientId: "anon:unknown",
      clientIp: null,
      bucket: "places",
      retryAfter: 1,
    });

    expect(emitted[0].attributes).not.toHaveProperty("client_ip");
    expect(emitted[0].attributes.client_id).toBe("anon:unknown");
  });

  it("falls back to the JSON line as the body when there is no error message", () => {
    const emitted = capture();

    emitAccessLine({
      type: "access",
      request_id: "req-ghi",
      method: "GET",
      path: "/api/cafes",
      status: 200,
      duration_ms: 12,
    });

    expect(emitted[0].body).toBe(
      JSON.stringify({
        type: "access",
        request_id: "req-ghi",
        method: "GET",
        path: "/api/cafes",
        status: 200,
        duration_ms: 12,
      }),
    );
    expect(emitted[0].attributes).toMatchObject({
      method: "GET",
      path: "/api/cafes",
      duration_ms: 12,
    });
  });

  it("drops fields that are neither string nor number", () => {
    const emitted = capture();

    emitAccessLine({ type: "access", route: { nested: "object" }, status: 200 });

    expect(emitted[0].attributes).not.toHaveProperty("route");
  });
});

describe("never-throws contract", () => {
  it("swallows a throwing logger instead of failing the request that logged", () => {
    (globalThis as Record<string, unknown>)[PROVIDER_KEY] = {
      emit: () => {
        throw new Error("collector down");
      },
    };

    expect(() => logError({ route: "GET /api/cafes", error: "boom" })).not.toThrow();
    expect(() => emitAccessLine({ type: "access", route: "GET /api/cafes" })).not.toThrow();
  });
});

describe("provider wiring", () => {
  it("builds and caches a provider once the endpoint is configured", () => {
    clearProvider();

    logError({ route: "GET /api/cafes", error: "boom" });

    const cached = (globalThis as Record<string, unknown>)[PROVIDER_KEY] as { emit?: unknown };
    expect(typeof cached?.emit).toBe("function");
  });

  it("stays silent and builds nothing when no endpoint is configured", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    clearProvider();

    logError({ route: "GET /api/cafes", error: "boom" });

    expect((globalThis as Record<string, unknown>)[PROVIDER_KEY]).toBeUndefined();
  });

  it("prefers the logs-specific endpoint over the signal-agnostic one", async () => {
    const { logEndpoint } = await import("@/lib/observability/otlp-logs");
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://logs.example/v1/logs";

    expect(logEndpoint()).toBe("https://logs.example/v1/logs");
  });
});

describe("shutdown flush", () => {
  it("flushes the batch and re-raises the signal so the container still exits", async () => {
    const forceFlush = vi.fn().mockResolvedValue(undefined);
    // Re-raising is the point: a listener suppresses Node's default terminate,
    // so a handler that only flushed would hang the container until SIGKILL.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    installShutdownFlush({ forceFlush } as unknown as Parameters<typeof installShutdownFlush>[0]);
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    expect(forceFlush).toHaveBeenCalled();

    killSpy.mockRestore();
  });
});
