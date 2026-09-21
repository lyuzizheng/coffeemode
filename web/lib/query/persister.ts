import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";
import { get, set, del, createStore } from "idb-keyval";
import { getViewerIdFromCookies } from "@/lib/auth/viewer-id";

const queryStore = createStore("coffeemode-query-cache", "queries");

const PERSISTER_KEY = "coffeemode-persisted-client";

/**
 * Stored payload: the dehydrated client plus the id of the viewer who
 * produced it (null = anonymous). The allow-list in persist-options admits
 * viewer-scoped data (private cafes, profile), so a cache written under
 * account A must never hydrate account B's session on a shared device
 * (BRAWUKA-573). A foreign or legacy (pre-owner) entry is deleted on read.
 */
type OwnedPersistedClient = {
  owner: string | null;
  client: PersistedClient;
};

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
    const owned: OwnedPersistedClient = {
      owner: getViewerIdFromCookies(),
      client: persistedClient,
    };
    await set(PERSISTER_KEY, owned, queryStore);
  },
  restoreClient: async () => {
    const stored = await get<OwnedPersistedClient>(PERSISTER_KEY, queryStore);
    if (stored === undefined || stored === null) return undefined;
    if (
      typeof stored !== "object" ||
      stored.owner !== getViewerIdFromCookies() ||
      typeof stored.client !== "object" ||
      stored.client === null
    ) {
      // Foreign-account or legacy-format residue: drop it rather than
      // hydrate another viewer's data.
      await del(PERSISTER_KEY, queryStore);
      return undefined;
    }
    return stored.client;
  },
  removeClient: async () => {
    await del(PERSISTER_KEY, queryStore);
  },
};
