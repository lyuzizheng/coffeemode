import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNetworkStatus } from "@/hooks/use-network-status";

/**
 * The store is a module singleton shared across tests in this file — order
 * matters: the 5xx case runs first and leaves the store "online".
 */
describe("useNetworkStatus (spec 0011 D9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays online when the health probe returns 5xx — server-down is not offline", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    const { result, unmount } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(result.current.isOffline).toBe(false);
    expect(result.current.isOnline).toBe(true);
    unmount();
  });

  it("flips offline only when the probe cannot complete — rejection or timeout", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, unmount } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isOffline).toBe(true);
    unmount();
  });
});
