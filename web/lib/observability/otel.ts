import "server-only";

import { registerOTel } from "@vercel/otel";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * OpenTelemetry registration for the Next.js server (BRAWUKA-606).
 *
 * One `registerOTel` call buys traces, the Tempo service map, and the
 * `traces_spanmetrics_*` RED metrics Grafana Cloud's metrics-generator derives
 * from spans — no hand-written Prometheus client
 * (docs/devops/grafana-cloud-adoption.md §3 P0-2).
 *
 * Everything deployment-specific is env-driven, so the two Dokploy stacks
 * differ only in their compose `environment:` block:
 * - `OTEL_EXPORTER_OTLP_ENDPOINT` — the Grafana Cloud OTLP gateway. Its
 *   presence is the on/off switch: unset (local dev, unit tests, CI) means no
 *   SDK and no export attempts against the OTLP default `localhost:4318`.
 * - `OTEL_EXPORTER_OTLP_HEADERS` — `Authorization=Basic <base64(instanceID:token)>`.
 * - `OTEL_RESOURCE_ATTRIBUTES` — `service.name` + `deployment.environment`
 *   (the attribute Grafana Cloud Application Observability filters on).
 * - `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` — `parentbased_traceidratio`
 *   at 0.1 in prod, 1 in staging (adoption doc §6 decision 3).
 */

/** Service identity — invariant across deployments, so it lives in code. */
const SERVICE_NAME = "coffeemode-web";

/** Next.js's per-request server span — the SERVER-kind span spanmetrics reads. */
const REQUEST_SPAN_TYPE = "BaseServer.handleRequest";

/**
 * Span types whose `next.route` attribute is the resolved route *pattern*.
 *
 * Next.js resolves the pattern, parks it on the root span's attribute map
 * (`setRootSpanAttribute('next.route', …)`), then copies it to `http.route` on
 * the request span. `BaseServer.renderToResponse` also carries a `next.route`
 * attribute, but that one is `ctx.pathname` — the raw request path — so it is
 * deliberately absent here: harvesting it would put a UUID in `http.route` and
 * blow up spanmetrics cardinality, which is the one thing this must not do.
 */
const ROUTE_PATTERN_SPAN_TYPES: Record<string, true> = {
  // The route module's own `definition.pathname`.
  "AppRouteRouteHandlers.runHandler": true,
  // The app page path being rendered.
  "AppRender.getBodyResult": true,
  // The page path `renderPageComponent` resolved.
  "NextNodeServer.findPageComponents": true,
};

/**
 * The configured OTLP endpoint, or null when tracing is off. The
 * traces-specific variable wins over the signal-agnostic one, matching the
 * OTLP spec and `@vercel/otel`'s own resolution order.
 */
export function otlpEndpoint(): string | null {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return endpoint ? endpoint : null;
}

/**
 * Stamp the route *template* onto the request span.
 *
 * Next.js already resolves the template (`/api/cafes/[id]`, never the raw
 * path) and copies it to `http.route` — but in 16.3.4 only when
 * `BaseServer.handleRequest` is the trace's root span: `base-server.js` reads
 * `tracer.getRootSpanAttributes()` and bails when the map is missing, and
 * `NextServer.getRequestHandler` is the actual root. The copy therefore never
 * happens, and the exported span keeps `http.target` (the raw path) with no
 * `http.route` at all — verified against a local OTLP sink.
 *
 * That matters twice over. `http.route` is the attribute the adoption doc
 * requires to be a template, and `span_name` is one of spanmetrics' four
 * default labels: left as `GET`, every route collapses into a single series,
 * so there is no per-route RED to read.
 *
 * `next.route` is only known once the route module runs, so this has to be an
 * end-of-span rewrite rather than a start-time attribute. Children always end
 * before their parent, so the template is in hand by the time the request span
 * ends. Mutating `attributes` here is the same move `@vercel/otel`'s own
 * composite processor makes (`Object.assign(span.attributes, …)` in `onEnd`),
 * and it lands before the batch processor serializes the span.
 */
class RouteTemplateSpanProcessor implements SpanProcessor {
  /** traceId → the template Next.js resolved for that request. */
  private readonly routes = new Map<string, string>();

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const { traceId } = span.spanContext();
    const attributes = span.attributes as Record<string, unknown>;
    const spanType = attributes["next.span_type"];
    const route = attributes["next.route"];

    // First writer wins, matching `setRootSpanAttribute`'s own semantics.
    if (
      typeof route === "string" &&
      typeof spanType === "string" &&
      ROUTE_PATTERN_SPAN_TYPES[spanType] === true &&
      !this.routes.has(traceId)
    ) {
      this.routes.set(traceId, route);
    }

    if (spanType === REQUEST_SPAN_TYPE && attributes["http.route"] === undefined) {
      const template = this.routes.get(traceId);
      if (template !== undefined) {
        attributes["http.route"] = template;
        // `name` is readonly on the `ReadableSpan` interface but a plain field
        // on the SDK's `Span` — the same object the batch processor exports.
        (span as { name: string }).name = `${attributes["http.method"] ?? "GET"} ${template}`;
      }
    }

    // The root span ends last, so this is where the per-trace entry retires.
    if (!span.parentSpanContext?.spanId) {
      this.routes.delete(traceId);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Start the OTel SDK. No-op when no OTLP endpoint is configured — the same
 * "unconfigured means silent" contract as `api-error-sink.ts`.
 */
export function registerOtel(): void {
  if (otlpEndpoint() === null) return;
  registerOTel({
    serviceName: SERVICE_NAME,
    // Ours first: `"auto"` expands to the batch processors, which serialize
    // whatever the span looks like when they run.
    spanProcessors: [new RouteTemplateSpanProcessor(), "auto"],
  });
}
