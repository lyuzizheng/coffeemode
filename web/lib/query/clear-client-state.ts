import type { QueryClient } from "@tanstack/react-query";
import { idbPersister } from "./persister";

/**
 * Full client-state teardown (BRAWUKA-732): drop the IndexedDB-persisted
 * query store first, then clear the live QueryClient. The order matters —
 * the persister must be gone before teardown completes or the next mount
 * rehydrates the state being torn down (BRAWUKA-573).
 *
 * Always resolves: a rejected `removeClient` (e.g. private-mode IndexedDB)
 * is reported through `onRemoveError` and the live client is still cleared.
 * Follow-up work (navigation, refresh) stays the caller's responsibility.
 */
export async function clearClientState(
  queryClient: QueryClient,
  onRemoveError?: (error: unknown) => void,
): Promise<void> {
  try {
    await idbPersister.removeClient();
  } catch (e) {
    onRemoveError?.(e);
  }
  queryClient.clear();
}
