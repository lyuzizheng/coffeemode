/**
 * Keys whose data should survive a tab close/reopen in IndexedDB.
 * Keep this list small to avoid bloating the client store.
 *
 * Query-key conventions elsewhere are flat and predictable: a mutation
 * should explicitly invalidate every key it affects rather than relying
 * on prefix matching.
 */
export const PERSISTED_QUERY_KEYS = [
  "profile",
  "cafe",
  "cafes-list",
] as const satisfies readonly string[];
