import { describe, expect, it } from "vitest";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { persistOptions } from "@/lib/query/persist-options";
import { PERSISTED_QUERY_KEYS } from "@/lib/query/keys";
import { idbPersister } from "@/lib/query/persister";

type DehydrateQuery = Parameters<
  NonNullable<
    NonNullable<typeof persistOptions.dehydrateOptions>["shouldDehydrateQuery"]
  >
>[0];

function fakeQuery(
  queryKey: unknown[],
  status: "pending" | "success" | "error",
): DehydrateQuery {
  return { queryKey, state: { status } } as unknown as DehydrateQuery;
}

describe("persistOptions", () => {
  it("uses the IndexedDB persister, non-empty buster, and valid retention window", () => {
    expect(persistOptions.persister).toBe(idbPersister);
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
    expect(typeof persistOptions.maxAge).toBe("number");
    expect(persistOptions.maxAge).toBeGreaterThan(0);
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster).toBeTruthy();
  });

  it("dehydrates allow-listed keys only once they hold data", () => {
    const shouldDehydrate = persistOptions.dehydrateOptions?.shouldDehydrateQuery;
    expect(shouldDehydrate).toBeDefined();

    // Ensure persisted query key contract is non-empty and matches explicit business entities
    expect(PERSISTED_QUERY_KEYS).toEqual(["profile", "cafe", "cafes-list"]);

    expect(shouldDehydrate?.(fakeQuery(["profile"], "success"))).toBe(true);
    expect(shouldDehydrate?.(fakeQuery(["cafe", "cafe-123"], "success"))).toBe(true);
    expect(shouldDehydrate?.(fakeQuery(["cafes-list", { city: "singapore" }], "success"))).toBe(true);

    // An in-flight or failed query has no durable data to restore, and a
    // `pending` one dehydrates with a Promise that IndexedDB cannot clone.
    expect(shouldDehydrate?.(fakeQuery(["profile"], "pending"))).toBe(false);
    expect(shouldDehydrate?.(fakeQuery(["cafe", "cafe-123"], "error"))).toBe(false);

    expect(shouldDehydrate?.(fakeQuery(["unknown"], "success"))).toBe(false);
    expect(shouldDehydrate?.(fakeQuery(["checkins"], "success"))).toBe(false);
    expect(shouldDehydrate?.(fakeQuery([], "success"))).toBe(false);
  });

  it("persists settled allow-listed data and skips a concurrently pending query", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const settledKey = ["cafes-list", { city: "singapore" }];
    const pendingKey = ["profile", "checkins"];

    const settled = queryClient.fetchQuery({
      queryKey: settledKey,
      queryFn: async () => ({ cafes: [] }),
    });
    // Never resolves: the query stays `pending` while the persister runs, which
    // is the race that produced the uncaught DOMException (BRAWUKA-213).
    queryClient
      .fetchQuery({ queryKey: pendingKey, queryFn: () => Promise.withResolvers<void>().promise })
      .catch(() => {});
    await settled;
    expect(queryClient.getQueryState(pendingKey)?.status).toBe("pending");

    const persisted: PersistedClient = {
      buster: persistOptions.buster ?? "test-buster",
      timestamp: Date.now(),
      clientState: dehydrate(queryClient, persistOptions.dehydrateOptions),
    };

    expect(persisted.clientState.queries.map((query) => query.queryKey)).toEqual([settledKey]);
    // IndexedDB's structured clone is the real contract: a dehydrated `pending`
    // query carries a Promise, which rejects the entire payload from the store.
    expect(() => structuredClone(persisted)).not.toThrow();
    await expect(idbPersister.persistClient(persisted)).resolves.toBeUndefined();

    // Cold start: what landed in IndexedDB must still restore the settled query.
    const restored = await idbPersister.restoreClient();
    expect(restored?.clientState.queries.map((query) => query.queryKey)).toEqual([settledKey]);

    queryClient.clear();
  });
});
