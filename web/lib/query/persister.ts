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
    await set(PERSISTER_KEY, JSON.stringify(persistedClient), queryStore);
  },
  restoreClient: async () => {
    const value = await get<string>(PERSISTER_KEY, queryStore);
    if (!value) return undefined;
    return JSON.parse(value) as PersistedClient;
  },
  removeClient: async () => {
    await del(PERSISTER_KEY, queryStore);
  },
};

/**
 * Clear the entire IndexedDB query cache. Call on sign-out.
 */
export async function clearQueryCache(): Promise<void> {
  await del(PERSISTER_KEY, queryStore);
}
