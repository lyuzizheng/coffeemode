import "server-only";

/**
 * One SIGTERM/SIGINT flush for every OTLP provider in the process
 * (BRAWUKA-609).
 *
 * Each provider holds a batch buffer — `BatchLogRecordProcessor` up to 5s of
 * lines, `PeriodicExportingMetricReader` up to its export interval of counter
 * increments — so a container that takes SIGTERM on redeploy would drop
 * whatever is still buffered. The errors that explain why it was being
 * redeployed are the most likely casualty.
 *
 * One handler per provider does not work: `process.once` removes a listener
 * before calling it, so the first provider to finish re-raises the signal and
 * the process exits while the others are still flushing. This coordinator
 * flushes them together and re-raises once, after all of them settle.
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

/** Providers to flush on the way out, in registration order. */
const providers: Flushable[] = [];

function onSignal(signal: NodeJS.Signals): void {
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });

  const flushed = Promise.all(providers.map((provider) => provider.forceFlush().catch(() => {})));

  void Promise.race([flushed, timeout]).finally(() => {
    // `once` already dropped the listener that fired; this drops the other one
    // so a second signal cannot start a second flush cycle.
    process.removeListener(signal, onSignal);
    process.kill(process.pid, signal);
  });
}

/**
 * Flush `provider` on the way out. Idempotent per provider, and safe to call
 * from every bundle that builds one — the signal handlers are registered once,
 * for the first provider only.
 */
export function installShutdownFlush(provider: Flushable): void {
  if (providers.includes(provider)) return;
  providers.push(provider);
  if (providers.length > 1) return;

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}
