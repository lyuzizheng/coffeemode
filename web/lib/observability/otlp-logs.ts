import "server-only";

import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { detectResources, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { registerLineSink } from "@shared/log";

/**
 * OTLP log shipping for the web app (BRAWUKA-607).
 *
 * The app already writes one JSON object per line to stdout (ADR-0004) and
 * already runs an OTel SDK for traces (`otel.ts`, BRAWUKA-606). This module
 * hangs the log outlet on that same SDK and the same OTLP endpoint, so a log
 * line arrives at Grafana Cloud Loki carrying the `trace_id` / `span_id` of
 * the request that produced it — the one thing a stdout collector cannot do,
 * and the reason the Alloy sidecar was dropped
 * (docs/devops/grafana-cloud-adoption.md §3 P0-1).
 *
 * What this deliberately does NOT collect: Next.js framework output, boot
 * logs, and crash stderr. Those stay in `docker logs`, which ADR-0004 already
 * designates the complete record.
 *
 * Field mapping (issue BRAWUKA-607):
 *   `type`                                  → `severity_text` (+ `log.type`)
 *   `error`                                 → body
 *   `route` `request_id` `code` `status`    → log-record attributes
 *   `method` `path` `duration_ms` `stack`   → log-record attributes
 *   `client_id` `client_ip` `bucket`        → log-record attributes
 *   `retry_after`                           → log-record attribute
 *
 * `client_ip` is the raw `cf-connecting-ip` behind a rate-limit denial. It
 * rides a log-record attribute, so it lands in structured metadata and never
 * becomes a label — the cardinality rule the issue sets out.
 *
 * Grafana Cloud converts OTLP logs to the Loki 3 model: a fixed list of
 * resource attributes becomes index labels, and everything else — the rest of
 * the resource, the scope, and every log-record attribute — becomes structured
 * metadata. So the index stays at `service_name` + `deployment_environment_name`
 * — the container declares `deployment.environment.name`, which is on the
 * promoted list, so staging and prod are separate stream sets — and the
 * 5,000-active-stream free-tier ceiling is never in play. `detected_level` is
 * derived from `severity_text` and is a label too. `| severity_text="ERROR"`
 * and `| route="…"` filter directly, with no `| json` parse.
 */

/** Service identity — invariant across deployments, so it lives in code. */
const SERVICE_NAME = "coffeemode-web";

/**
 * The app's own `type` vocabulary mapped to OTel severity. `access` is
 * informational: the proxy runs before routing, so its line records the
 * request, not an outcome.
 */
const SEVERITY: Record<string, { number: SeverityNumber; text: string }> = {
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  access: { number: SeverityNumber.INFO, text: "INFO" },
};

/**
 * Line fields copied to log-record attributes under their own names. `error`
 * is absent on purpose — it becomes the body.
 */
const ATTRIBUTE_FIELDS = [
  "request_id",
  "route",
  "code",
  "status",
  "method",
  "path",
  "duration_ms",
  "stack",
  "client_id",
  "client_ip",
  "bucket",
  "retry_after",
] as const;

/**
 * The configured OTLP endpoint, or null when log shipping is off. Mirrors the
 * OTLP spec's resolution order — the logs-specific variable wins over the
 * signal-agnostic one — so it agrees with what `OTLPLogExporter` resolves for
 * itself. Unset (local dev, unit tests, CI) means no SDK and no export
 * attempts against the OTLP default `localhost:4318`.
 */
export function logEndpoint(): string | null {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return endpoint ? endpoint : null;
}

/**
 * The provider is process-wide, not module-wide.
 *
 * Next.js compiles `proxy.ts` into its own bundle, so `@shared/log` is
 * instantiated once per bundle — measured at three instances in one dev server
 * (BRAWUKA-607). A module-level singleton would therefore build a second
 * `LoggerProvider`, and a second `BatchLogRecordProcessor` with it, for the
 * proxy's copy: two flush timers, two HTTP agents, two shutdown paths. Keying
 * on `globalThis` makes the provider genuinely one per process, whichever
 * bundle asks first.
 */
const PROVIDER_KEY = "__coffeemodeOtlpLogs";

function createLogger(): Logger {
  const provider = new LoggerProvider({
    // `service.name` is invariant, so it lives in code; everything else comes
    // from `OTEL_RESOURCE_ATTRIBUTES` on the container — which is where
    // `deployment.environment.name` is declared, and the only thing that tells
    // a staging line from a prod one in Loki.
    //
    // Deliberately NOT `defaultResource()`: it adds `host.name`, `process.pid`
    // and `service.instance.id`, and Grafana Cloud promotes a fixed list of
    // resource attributes to Loki index labels — `service.instance.id` among
    // them, which is one stream per container start. `envDetector` alone keeps
    // the resource to what the deployment declares.
    resource: resourceFromAttributes({ "service.name": SERVICE_NAME }).merge(
      detectResources({ detectors: [envDetector] }),
    ),
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  });
  installShutdownFlush(provider);
  return provider.getLogger(SERVICE_NAME);
}

/**
 * Flush the batch on the way out.
 *
 * `BatchLogRecordProcessor` holds up to 5s of lines, so a container that takes
 * SIGTERM on redeploy would drop everything still buffered — the errors that
 * explain why it was being redeployed, most likely.
 *
 * The signal is re-raised once the flush settles. Registering a listener
 * suppresses Node's default terminate, so without the re-raise the container
 * would hang until SIGKILL instead of shutting down.
 */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 2_000;

export function installShutdownFlush(provider: LoggerProvider): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    // Bounded: a collector that is itself down must not hold the container
    // open past its stop grace period.
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    });

    void Promise.race([provider.forceFlush().catch(() => {}), timeout]).finally(() => {
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    });
  };

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}

function logger(): Logger | null {
  if (logEndpoint() === null) return null;

  const store = globalThis as unknown as Record<string, Logger | null | undefined>;
  const existing = store[PROVIDER_KEY];
  if (existing !== undefined) return existing;

  const created = createLogger();
  store[PROVIDER_KEY] = created;
  return created;
}

/**
 * Ship one already-shaped line. Never throws: observability must not break the
 * request that produced it, and this runs inside callers' `catch` blocks.
 *
 * Trace context is not passed explicitly — `Logger.emit` reads
 * `context.active()` and stamps `trace_id` / `span_id` from the span in scope,
 * which is what makes an error line clickable through to its Tempo trace.
 */
function emit(line: Record<string, unknown>): void {
  try {
    const target = logger();
    if (target === null) return;

    const type = typeof line.type === "string" ? line.type : "";
    const severity = SEVERITY[type] ?? { number: SeverityNumber.INFO, text: "INFO" };

    // `log.type` keeps the app's own vocabulary queryable: `severity_text` is
    // coarse (INFO covers everything informational), so it cannot on its own
    // separate an access line from any future informational line.
    const attributes: Record<string, string | number> = { "log.type": type };
    for (const field of ATTRIBUTE_FIELDS) {
      const value = line[field];
      if (typeof value === "string" || typeof value === "number") attributes[field] = value;
    }

    target.emit({
      severityNumber: severity.number,
      severityText: severity.text,
      // The error message when there is one; otherwise the line itself, so an
      // access line still reads as the JSON object it was written as.
      body: typeof line.error === "string" ? line.error : JSON.stringify(line),
      attributes,
    });
  } catch {
    // Benign: a failed export must never surface as a request failure.
  }
}

/**
 * Register the OTLP emitter as the line sink. Idempotent, and safe to call
 * from every bundle that emits lines — the proxy calls it too, because its
 * copy of `@shared/log` has its own sink slot.
 */
export function registerOtlpLogSink(): void {
  registerLineSink(emit);
}
