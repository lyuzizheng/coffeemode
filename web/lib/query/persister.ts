import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";
import { get, set, del, createStore } from "idb-keyval";

const queryStore = createStore("coffeemode-query-cache", "queries");

const PERSISTER_KEY = "coffeemode-persisted-client";

/**
 * IndexedDB persister for TanStack Query.
 *
 * Stores the dehydrated query client under a single key. The allow-list is
 * enforced by `shouldDehydrateQuery` in the `PersistQueryClientProvider`.
 */
export const idbPersister: Persister = {
  persistClient: async (persistedClient: PersistedClient) => {
    // IndexedDB uses the structured clone algorithm, which preserves Date,
    // undefined, Maps, etc. better than JSON.stringify/parse.
    await set(PERSISTER_KEY, persistedClient, queryStore);
  },
  restoreClient: async () => {
    return get<PersistedClient>(PERSISTER_KEY, queryStore);
  },
  removeClient: async () => {
    await del(PERSISTER_KEY, queryStore);
  },
};
