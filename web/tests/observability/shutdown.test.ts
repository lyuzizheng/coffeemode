import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installShutdownFlush } from "@/lib/observability/shutdown";

/**
 * The coordinator's contract, driven through its own registration seam.
 *
 * `shutdown.ts` keeps one signal handler for the whole process, so this suite
 * must be the only thing registering providers — a real `LoggerProvider` or
 * `MeterProvider` built earlier in the same module graph would already own the
 * handler and the emit below would flush that instead.
 */

/** The registry is process-wide by design, so it outlives a single test. */
const REGISTRY_KEY = "__coffeemodeShutdownProviders";

function resetCoordinator(): void {
  delete (globalThis as Record<string, unknown>)[REGISTRY_KEY];
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
}

beforeEach(resetCoordinator);
afterEach(resetCoordinator);

describe("shutdown flush", () => {
  it("flushes every registered provider, once each, then re-raises the signal", async () => {
    const logs = vi.fn().mockResolvedValue(undefined);
    const metrics = vi.fn().mockResolvedValue(undefined);
    // Re-raising is the point: a listener suppresses Node's default terminate,
    // so a handler that only flushed would hang the container until SIGKILL.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const logsProvider = { forceFlush: logs };
    installShutdownFlush(logsProvider);
    installShutdownFlush(logsProvider);
    installShutdownFlush({ forceFlush: metrics });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    // Both, not just the first: one handler per provider would let whichever
    // settles first re-raise while the other is still flushing.
    expect(logs).toHaveBeenCalledTimes(1);
    expect(metrics).toHaveBeenCalledTimes(1);

    killSpy.mockRestore();
  });

  it("shares one registry across module instances", async () => {
    // Next.js compiles each entry point into its own bundle, so `shutdown.ts`
    // is evaluated more than once in one process — the proxy bundle builds the
    // LoggerProvider, the route bundle the MeterProvider. Two module-scoped
    // registries would mean two SIGTERM handlers, and the first to settle
    // re-raising while the other provider is still flushing.
    vi.resetModules();
    const proxyBundle = await import("@/lib/observability/shutdown");
    vi.resetModules();
    const routeBundle = await import("@/lib/observability/shutdown");
    expect(proxyBundle.installShutdownFlush).not.toBe(routeBundle.installShutdownFlush);

    const logs = vi.fn().mockResolvedValue(undefined);
    const metrics = vi.fn().mockResolvedValue(undefined);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    proxyBundle.installShutdownFlush({ forceFlush: logs });
    routeBundle.installShutdownFlush({ forceFlush: metrics });
    // One handler pair, not two: the second bundle joins the first's registry.
    expect(process.listeners("SIGTERM")).toHaveLength(1);

    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    expect(logs).toHaveBeenCalledTimes(1);
    expect(metrics).toHaveBeenCalledTimes(1);

    killSpy.mockRestore();
  });

  it("clears foreign signal listeners so the re-raise reaches default terminate", async () => {
    // The Postgres pool registers `process.on` (not `once`) and does not exit —
    // it closes the pool and sets `exitCode`, leaving the HTTP server holding
    // the event loop open. Left in place it would swallow the re-raise and the
    // container would wait out its stop grace period and die by SIGKILL.
    const poolClose = vi.fn();
    process.on("SIGTERM", poolClose);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    installShutdownFlush({ forceFlush: vi.fn().mockResolvedValue(undefined) });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    // It ran on this delivery — the pool does get closed — but it is gone
    // before the re-raise, so the re-raise is unhandled.
    expect(poolClose).toHaveBeenCalledTimes(1);
    expect(process.listeners("SIGTERM")).toHaveLength(0);
    expect(process.listeners("SIGINT")).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("gives up on a provider that never settles", async () => {
    // A collector that is itself down must not hold the container open past
    // its stop grace period.
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    installShutdownFlush({ forceFlush: () => new Promise<void>(() => {}) });
    process.emit("SIGTERM", "SIGTERM");
    expect(killSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

    killSpy.mockRestore();
    vi.useRealTimers();
  });
});
