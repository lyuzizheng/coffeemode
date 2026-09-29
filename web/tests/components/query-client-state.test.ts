import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateCheckinQueries } from "@/lib/query/invalidation";
import { clearClientState } from "@/lib/query/clear-client-state";

// BRAWUKA-732: the shared invalidation set and the shared client-state
// teardown are the contract every check-in write and every sign-out /
// account-delete / restore-failure path now relies on.

const mockRemoveClient = vi.fn<() => Promise<void>>();

vi.mock("@/lib/query/persister", () => ({
  idbPersister: {
    removeClient: (...args: unknown[]) => mockRemoveClient(...(args as [])),
  },
}));

describe("invalidateCheckinQueries", () => {
  it("invalidates exactly the five affected keys for the cafe", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    invalidateCheckinQueries(queryClient, "cafe-1");

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([
      ["cafe", "cafe-1"],
      ["cafe-checkins", "cafe-1"],
      ["last-checkin", "cafe-1"],
      ["profile"],
      ["cafes-list"],
    ]);
  });
});

describe("clearClientState", () => {
  beforeEach(() => {
    mockRemoveClient.mockReset();
    mockRemoveClient.mockResolvedValue(undefined);
  });

  it("removes the persisted client before clearing the live one", async () => {
    const queryClient = new QueryClient();
    const order: string[] = [];
    mockRemoveClient.mockImplementation(async () => {
      order.push("removeClient");
    });
    vi.spyOn(queryClient, "clear").mockImplementation(() => {
      order.push("clear");
    });

    await clearClientState(queryClient);

    expect(order).toEqual(["removeClient", "clear"]);
  });

  it("still clears the live client when persisted removal rejects", async () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    const failure = new Error("idb unavailable");
    mockRemoveClient.mockRejectedValue(failure);
    const onRemoveError = vi.fn();

    await expect(clearClientState(queryClient, onRemoveError)).resolves.toBeUndefined();
    expect(onRemoveError).toHaveBeenCalledWith(failure);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("omits error reporting when no callback is given and still clears", async () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, "clear");
    mockRemoveClient.mockRejectedValue(new Error("idb unavailable"));

    await expect(clearClientState(queryClient)).resolves.toBeUndefined();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
