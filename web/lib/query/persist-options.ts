import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { idbPersister } from "./persister";
import { PERSISTED_QUERY_KEYS } from "./keys";

/**
 * Persist options for `PersistQueryClientProvider`.
 *
 * Only allow-listed keys that reached `success` are written to IndexedDB.
 * Other queries stay in memory and are refetched on the next session.
 */
export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: idbPersister,
  buster: "v1",
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  dehydrateOptions: {
    // Allow-listed key AND settled success. `dehydrateQuery` attaches a
    // `promise` field to any query still in `pending`; a Promise cannot pass
    // IndexedDB's structured clone, so `idbPersister.persistClient` throws
    // `DOMException: #<Promise> could not be cloned` and the whole persist
    // pass (including the settled queries around it) is lost. Mirrors
    // query-core's own `defaultShouldDehydrateQuery`.
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" &&
      PERSISTED_QUERY_KEYS.includes(
        query.queryKey[0] as (typeof PERSISTED_QUERY_KEYS)[number],
      ),
  },
};
