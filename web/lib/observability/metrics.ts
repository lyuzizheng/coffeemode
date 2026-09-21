import "server-only";

import type { Attributes, Counter, Meter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { detectResources, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { installShutdownFlush } from "./shutdown";

/**
 * Business metrics for the web app (BRAWUKA-609).
 *
 * The RED half of the observability surface comes free: Grafana Cloud's
 * metrics-generator derives `traces_spanmetrics_*` from the spans the app
 * already exports (`otel.ts`, BRAWUKA-606), so per-route rate / error /
 * duration needs no code here. What spanmetrics cannot know is what the
 * business did — how many cafes were created, how many people signed in. Those
 * are counters this module owns.
 *
 * Transport is OTLP, on the same gateway and the same credential as traces and
 * logs, so there is no scrape endpoint to expose, no second credential, and no
 * collector to run (docs/devops/grafana-cloud-adoption.md §3 P0-3).
 *
 * Cardinality is the constraint that shapes every choice below. The free tier
 * allows 10k active series, and Prometheus promotes a fixed list of resource
 * attributes to series labels — so the resource is deliberately narrow, and
 * every instrument carries only bounded dimensions.
 *
 * Deliberately NOT here: a rate-limit counter. 429 hits are a low-frequency
 * security event whose per-event detail (`client_id`, `bucket`, `retry_after`)
 * is the point, so they stay one log line each in Loki and any count is
 * derived with a LogQL metric query (BRAWUKA-605 §6 decision 5).
 */

/** Service identity — invariant across deployments, so it lives in code. */
const SERVICE_NAME = "coffeemode-web";

/**
 * Which external POI a creation started from, or `manual` when the creator
 * typed the cafe in. Three values, all read off the request body — so the
 * counter's series count is bounded by 3 × environments, not by traffic.
 */
export type CafeCreationSource = "google" | "apple" | "manual";

const CAFE_CREATED = "coffeemode.cafe.created";
const CAFE_CREATED_DESCRIPTION = "Cafes created (successful POST /api/cafes)";
const AUTH_LOGIN = "coffeemode.auth.login";
const AUTH_LOGIN_DESCRIPTION = "Completed sign-ins (successful GET /auth/callback)";

/**
 * How often the reader pushes. The OTel default, pinned so the number is
 * visible rather than implied. Grafana Cloud bills active series, not samples,
 * so a shorter interval buys nothing; the shutdown flush is what keeps a
 * redeploy from dropping the tail.
 */
const EXPORT_INTERVAL_MS = 60_000;

/**
 * The configured OTLP endpoint, or null when metric shipping is off. Mirrors
 * `otlpEndpoint()` / `logEndpoint()`: the signal-specific variable wins over
 * the signal-agnostic one, matching the OTLP spec.
 */
export function metricEndpoint(): string | null {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return endpoint ? endpoint : null;
}

/**
 * The provider is process-wide, not module-wide — the same reasoning as
 * `otlp-logs.ts`: Next.js compiles each entry point into its own bundle, and a
 * module-level singleton would build a second `MeterProvider`, and a second
 * export timer with it, for the second bundle.
 */
const PROVIDER_KEY = "__coffeemodeOtlpMetrics";

function createMeter(): Meter {
  const provider = new MeterProvider({
    // `service.name` is invariant, so it lives in code; everything else comes
    // from `OTEL_RESOURCE_ATTRIBUTES` on the container — which is where
    // `deployment.environment.name` is declared, and the only thing that tells
    // a staging series from a prod one in Prometheus.
    //
    // Deliberately NOT `defaultResource()`: it adds `host.name`, `process.pid`
    // and `service.instance.id`, and Prometheus promotes a fixed list of
    // resource attributes to series labels — `service.instance.id` among them,
    // which is one series per container start. `envDetector` alone keeps the
    // resource to what the deployment declares.
    resource: resourceFromAttributes({ "service.name": SERVICE_NAME }).merge(
      detectResources({ detectors: [envDetector] }),
    ),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: EXPORT_INTERVAL_MS,
      }),
    ],
  });
  installShutdownFlush(provider);
  return provider.getMeter(SERVICE_NAME);
}

function meter(): Meter | null {
  if (metricEndpoint() === null) return null;

  const store = globalThis as unknown as Record<string, Meter | null | undefined>;
  const existing = store[PROVIDER_KEY];
  if (existing !== undefined) return existing;

  const created = createMeter();
  store[PROVIDER_KEY] = created;
  return created;
}

/** Instruments built so far, and the meter that built them. */
let instrumentMeter: Meter | null = null;
let instruments: Record<string, Counter> = {};

/**
 * Resolve a counter by name, building it once per meter. The SDK dedupes
 * storage by instrument name, so rebuilding would not double-count — but it
 * would allocate a descriptor and a wrapper on every request.
 */
function counter(name: string, description: string): Counter | null {
  const target = meter();
  if (target === null) return null;

  // A different meter (first call, or a test re-seeding the slot) invalidates
  // the memo: an instrument is bound to the meter that built it.
  if (target !== instrumentMeter) {
    instruments = {};
    instrumentMeter = target;
  }

  const existing = instruments[name];
  if (existing !== undefined) return existing;

  const created = target.createCounter(name, { description });
  instruments[name] = created;
  return created;
}

/**
 * Record one increment. Never throws: observability must not break the request
 * that produced it, and this runs on the success path of a mutation.
 */
function increment(name: string, description: string, attributes?: Attributes): void {
  try {
    counter(name, description)?.add(1, attributes);
  } catch {
    // Benign: a failed export must never surface as a request failure.
  }
}

/**
 * One cafe created — `POST /api/cafes` answered 201.
 *
 * Call it only after the transaction committed: a 409 dedupe or a rejected
 * photo is not a creation, and counting attempts would make the series track
 * traffic instead of the business.
 */
export function recordCafeCreated(source: CafeCreationSource): void {
  increment(CAFE_CREATED, CAFE_CREATED_DESCRIPTION, { source });
}

/**
 * One completed sign-in — the OAuth callback exchanged its code *and* the
 * profile row landed. A callback that fails either step signs the user back
 * out, so it is not a login and must not be counted as one.
 */
export function recordLogin(): void {
  increment(AUTH_LOGIN, AUTH_LOGIN_DESCRIPTION);
}
