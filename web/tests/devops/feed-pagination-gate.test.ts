import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { armCursorRecoveryWaiters } from "../../scripts/lib/feed-pagination-gate.mjs";

/**
 * Feed-pagination gate cursor waiters (BRAWUKA-838).
 *
 * The gate arms both `page.waitForResponse` waiters before navigation and
 * awaits them after the scroll drive. When the drive throws (or the context
 * closes), the waiter that is never awaited rejects as an unhandled rejection
 * and Node kills the process — the real error is lost and the suite dies
 * without recording the gate failure. That is exactly how the T12 CI failure
 * presented: only `page.waitForResponse: Target page, context or browser has
 * been closed` reached the log.
 *
 * The shell-overlay half of the fix (the gate must wait for the SSR shell's
 * masthead to detach before resolving the sentinel, so it never drives the
 * shell's transient duplicate feed) is a browser behaviour; it is covered by
 * the gate itself in the E2E suite.
 */
describe("feed-pagination gate cursor waiters (BRAWUKA-838)", () => {
  it("leaves no unhandled rejection when the drive fails before the waiters settle", async () => {
    const unhandled: unknown[] = [];
    // Bound method, not a wrapper: `off` needs the same listener reference.
    const recordUnhandled = unhandled.push.bind(unhandled);
    process.on("unhandledRejection", recordUnhandled);
    try {
      const closed = new Error("Target page, context or browser has been closed");
      const page = { waitForResponse: () => Promise.reject(closed) } as unknown as Page;
      const { cursorPromise, recoveryPromise } = armCursorRecoveryWaiters(page, "cafe-1", {
        cursorFired: false,
      });

      await expect(cursorPromise).rejects.toThrow(/has been closed/);
      // Node reports an unhandled rejection on the tick after the microtask
      // queue drains; the sibling waiter must already be marked handled.
      const { promise: tick, resolve: onTick } = Promise.withResolvers<void>();
      setImmediate(onTick);
      await tick;
      expect(unhandled).toEqual([]);

      // Marking it handled must not swallow the rejection for the caller.
      await expect(recoveryPromise).rejects.toThrow(/has been closed/);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });
});
