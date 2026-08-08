import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { idbPersister } from "./persister";
import { PERSISTED_QUERY_KEYS } from "./keys";

/**
 * Persist options for `PersistQueryClientProvider`.
 *
 * Only allow-listed keys are written to IndexedDB. Other queries stay in
 * memory and are refetched on the next session.
 */
export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const key = query.queryKey[0];
      return PERSISTED_QUERY_KEYS.includes(key as (typeof PERSISTED_QUERY_KEYS)[number]);
    },
  },
};
