/**
 * Client-safe typed readers for `NEXT_PUBLIC_*` values (BRAWUKA-250).
 *
 * Product parameters live in `web/config/app.yaml`; `next.config.ts` mirrors
 * the client-facing subset into `NEXT_PUBLIC_*` env at build time because the
 * browser bundle cannot read the YAML. These getters are the only client
 * channel — client code never hardcodes the value and never parses env
 * inline. Each fallback mirrors the current `app.yaml` value so local dev
 * and unit tests (no Next env) behave identically; `tests/client-env.test.ts`
 * pins every fallback against `appConfig` so drift fails fast.
 *
 * Next only inlines *static* `process.env.NEXT_PUBLIC_X` references into the
 * browser bundle — a dynamic `process.env[name]` subscript survives as a
 * runtime lookup and reads nothing client-side. So every getter below passes
 * a static member reference; the shared parser only validates the value.
 *
 * Client-safe by construction: no `node:` imports, no `server-only` guard.
 * Safe to import from components, hooks, and the TanStack Query setup.
 */

/** Parse an already-resolved env value; fall back when missing or malformed. */
export function envPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw !== undefined && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

/** `checkins.noteMaxChars` — check-in note input cap. */
export function getCheckinNoteMaxChars(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_CHECKIN_NOTE_MAX, 500);
}

/** `profile.displayNameMaxChars` — inline display-name edit cap. */
export function getDisplayNameMaxChars(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_DISPLAY_NAME_MAX, 24);
}

/** `profile.handle.maxChars` — public handle input cap. */
export function getHandleMaxChars(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_HANDLE_MAX, 30);
}

/** `images.maxOriginalDimension` — client canvas downscale target (px). */
export function getImageMaxDimension(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_IMAGE_MAX_DIMENSION, 4096);
}

/** `search.client.minQueryLength` — search-as-you-type trigger (DG44). */
export function getSearchMinQueryLength(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_SEARCH_MIN_QUERY_LENGTH, 3);
}

/** `search.client.debounceMs` — search-as-you-type debounce (DG47). */
export function getSearchDebounceMs(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_SEARCH_DEBOUNCE_MS, 400);
}

/** `query.staleTimeMs` — TanStack Query default stale time. */
export function getQueryStaleTimeMs(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_QUERY_STALE_TIME_MS, 300_000);
}

/** `query.gcTimeMs` — TanStack Query default garbage-collection time. */
export function getQueryGcTimeMs(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_QUERY_GC_TIME_MS, 86_400_000);
}

/** `query.persistMaxAgeMs` — IndexedDB persist retention. */
export function getQueryPersistMaxAgeMs(): number {
  return envPositiveInt(process.env.NEXT_PUBLIC_QUERY_PERSIST_MAX_AGE_MS, 604_800_000);
}
