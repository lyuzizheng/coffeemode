import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerOTel = vi.fn();

vi.mock("@vercel/otel", () => ({ registerOTel }));

const { otlpEndpoint, registerOtel } = await import("@/lib/observability/otel");

/** The slice of a span this suite drives — enough for `onEnd` to run. */
type FakeSpan = {
  name: string;
  attributes: Record<string, unknown>;
  parentSpanContext?: { spanId: string };
  spanContext: () => { traceId: string };
};

function fakeSpan(
  traceId: string,
  spanType: string,
  attributes: Record<string, unknown> = {},
  parentSpanId?: string,
): FakeSpan {
  return {
    name: "span",
    attributes: { "next.span_type": spanType, ...attributes },
    ...(parentSpanId === undefined ? {} : { parentSpanContext: { spanId: parentSpanId } }),
    spanContext: () => ({ traceId }),
  };
}

/** The processor `registerOtel` actually hands to `@vercel/otel`. */
function registeredProcessor(): SpanProcessor {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example/otlp";
  registerOtel();
  const [config] = registerOTel.mock.calls.at(-1) as [{ spanProcessors: SpanProcessor[] }];
  return config.spanProcessors[0];
}

const end = (processor: SpanProcessor, span: FakeSpan) =>
  processor.onEnd(span as unknown as ReadableSpan);

describe("otlpEndpoint", () => {
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  afterEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  it("is null when neither variable is set", () => {
    expect(otlpEndpoint()).toBeNull();
  });

  it("is null for an empty or whitespace-only value", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "   ";
    expect(otlpEndpoint()).toBeNull();
  });

  it("returns the signal-agnostic endpoint, trimmed", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = " https://otlp.example/otlp ";
    expect(otlpEndpoint()).toBe("https://otlp.example/otlp");
  });

  it("prefers the traces-specific endpoint over the signal-agnostic one", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example/otlp";
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://traces.example/v1/traces";
    expect(otlpEndpoint()).toBe("https://traces.example/v1/traces");
  });
});

describe("registerOtel", () => {
  beforeEach(() => {
    registerOTel.mockClear();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  afterEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  it("registers nothing when no endpoint is configured", () => {
    registerOtel();
    expect(registerOTel).not.toHaveBeenCalled();
  });

  it("registers the coffeemode-web service with the route processor ahead of the batch ones", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example/otlp";
    registerOtel();
    expect(registerOTel).toHaveBeenCalledExactlyOnceWith({
      serviceName: "coffeemode-web",
      spanProcessors: [expect.any(Object), "auto"],
    });
  });
});

describe("route template on the request span", () => {
  beforeEach(() => {
    registerOTel.mockClear();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  afterEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  });

  it("stamps the resolved template onto http.route and the span name", () => {
    const processor = registeredProcessor();
    end(
      processor,
      fakeSpan("t1", "AppRouteRouteHandlers.runHandler", { "next.route": "/api/cafes/[id]" }, "p1"),
    );

    const request = fakeSpan(
      "t1",
      "BaseServer.handleRequest",
      { "http.method": "GET", "http.target": "/api/cafes/11111111-1111-4111-8111-111111111111" },
      "p1",
    );
    end(processor, request);

    expect(request.attributes["http.route"]).toBe("/api/cafes/[id]");
    expect(request.name).toBe("GET /api/cafes/[id]");
  });

  it("never lets the raw request path reach http.route", () => {
    const processor = registeredProcessor();
    // `BaseServer.renderToResponse` carries `ctx.pathname` — the raw path — and
    // is the one `next.route` writer that must not be harvested: a UUID there
    // is what blows up spanmetrics cardinality.
    end(
      processor,
      fakeSpan(
        "t1",
        "BaseServer.renderToResponse",
        { "next.route": "/api/cafes/11111111-1111-4111-8111-111111111111" },
        "p1",
      ),
    );

    const request = fakeSpan("t1", "BaseServer.handleRequest", { "http.method": "GET" }, "p1");
    end(processor, request);

    expect(request.attributes["http.route"]).toBeUndefined();
    expect(request.name).toBe("span");
  });

  it("leaves the request span alone when no route was resolved", () => {
    const processor = registeredProcessor();
    const request = fakeSpan("t1", "BaseServer.handleRequest", { "http.method": "GET" }, "p1");
    end(processor, request);

    expect(request.attributes["http.route"]).toBeUndefined();
    expect(request.name).toBe("span");
  });

  it("keeps an http.route Next.js already set", () => {
    const processor = registeredProcessor();
    end(
      processor,
      fakeSpan("t1", "AppRouteRouteHandlers.runHandler", { "next.route": "/api/cafes/[id]" }, "p1"),
    );

    const request = fakeSpan(
      "t1",
      "BaseServer.handleRequest",
      { "http.method": "GET", "http.route": "/api/cafes/[id]" },
      "p1",
    );
    end(processor, request);

    expect(request.attributes["http.route"]).toBe("/api/cafes/[id]");
    expect(request.name).toBe("span");
  });

  it("does not carry a route from one trace into the next", () => {
    const processor = registeredProcessor();
    end(
      processor,
      fakeSpan("t1", "AppRouteRouteHandlers.runHandler", { "next.route": "/api/cafes/[id]" }, "p1"),
    );
    end(processor, fakeSpan("t1", "NextServer.getRequestHandler", {}, undefined));

    const request = fakeSpan("t2", "BaseServer.handleRequest", { "http.method": "GET" }, "p2");
    end(processor, request);

    expect(request.attributes["http.route"]).toBeUndefined();
  });
});
