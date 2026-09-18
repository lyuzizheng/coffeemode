/**
 * Search URL state — the `?q=&city=&filter_*=` query string that mirrors the
 * discovery search surface (DG48: replace, never push).
 *
 * A module store, not a hook: the discovery controller's `close()` writes
 * `/` when a selection ends and must re-attach the live search params —
 * reading `window.location.search` there is wrong because the current entry
 * is `/cafes/[id]` (params deliberately absent from canonical cafe URLs).
 * The single writer is `useDiscoverySearch`'s sync effect; the single reader
 * is the controller's close path.
 */

let currentSearch = "";

/** Called by the search-state owner whenever the query string changes. */
export function setSearchUrlState(search: string): void {
  currentSearch = search;
}

/** The latest search query string (`""` or `"?…"`) for re-attaching to `/`. */
export function getSearchUrlState(): string {
  return currentSearch;
}
