import "server-only";

/**
 * One SIGTERM/SIGINT flush for every OTLP provider in the process
 * (BRAWUKA-609).
 *
 * Each provider holds a batch buffer — `BatchLogRecordProcessor` and
 * `BatchSpanProcessor` up to 5s of records, `PeriodicExportingMetricReader` up
 * to its export interval of counter increments — so a container that takes
 * SIGTERM on redeploy would drop whatever is still buffered. The errors that
 * explain why it was being redeployed are the most likely casualty.
 *
 * One handler per provider does not work: `process.once` removes a listener
 * before calling it, so the first provider to finish re-raises the signal and
 * the process exits while the others are still flushing. This coordinator
 * flushes them together and re-raises once, after all of them settle.
 *
 * The registry is on `globalThis`, not in module scope, for the same reason
 * `otlp-logs.ts` and `metrics.ts` keep their providers there: Next.js compiles
 * each entry point into its own bundle, so a module-level array would be
 * per-bundle. That is not hypothetical here — the proxy bundle ships an access
 * line on the first request and builds the `LoggerProvider`, while the route
 * bundle only builds the `MeterProvider` on the first `POST /api/cafes`. Two
 * module instances would mean two registries, two `SIGTERM` handlers, and the
 * first one to settle re-raising while the other provider is still flushing —
 * exactly the bug this module exists to prevent.
 *
 * The signal is re-raised because registering a listener suppresses Node's
 * default terminate — without the re-raise the container would hang until
 * SIGKILL instead of shutting down.
 */

/** The slice of a provider this needs. */
export interface Flushable {
  forceFlush(): Promise<void>;
}

/**
 * Bounded: a collector that is itself down must not hold the container open
 * past its stop grace period.
 */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 2_000;

/** Process-wide, so every bundle shares one registry and one handler pair. */
const REGISTRY_KEY = "__coffeemodeShutdownProviders";

function registry(): Flushable[] {
  const store = globalThis as unknown as Record<string, Flushable[] | undefined>;
  const existing = store[REGISTRY_KEY];
  if (existing !== undefined) return existing;

  const created: Flushable[] = [];
  store[REGISTRY_KEY] = created;
  return created;
}

function onSignal(signal: NodeJS.Signals): void {
  // Every listener for both signals goes, before anything else. The re-raise
  // below has to reach Node's default terminate, and a plain `process.on`
  // listener elsewhere would otherwise catch it, do its work, set `exitCode`
  // — and leave the HTTP server holding the event loop open, so the container
  // waits out its stop grace period and dies by SIGKILL. Dropping both signals
  // also means a second signal during the flush kills immediately, which is
  // what a second signal means.
  //
  // The only other listener in this process is the Postgres pool's, and its
  // `closePool()` is a courtesy: the OS closes those sockets on exit either
  // way.
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");

  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });

  const flushed = Promise.all(
    registry().map((provider) => provider.forceFlush().catch(() => {})),
  );

  void Promise.race([flushed, timeout]).finally(() => {
    process.kill(process.pid, signal);
  });
}

/**
 * Flush `provider` on the way out. Idempotent per provider, and safe to call
 * from every bundle that builds one — the registry is shared, and the signal
 * handlers are registered once, by whichever bundle gets there first.
 */
export function installShutdownFlush(provider: Flushable): void {
  const providers = registry();
  if (providers.includes(provider)) return;
  providers.push(provider);
  if (providers.length > 1) return;

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}
