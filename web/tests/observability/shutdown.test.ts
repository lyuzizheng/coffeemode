import { describe, expect, it, vi } from "vitest";
import { installShutdownFlush } from "@/lib/observability/shutdown";

/**
 * The coordinator's contract, driven through its own registration seam.
 *
 * `shutdown.ts` keeps one signal handler for the whole process, so this suite
 * must be the only thing registering providers — a real `LoggerProvider` or
 * `MeterProvider` built earlier in the same module graph would already own the
 * handler and the emit below would flush that instead.
 */
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
});
