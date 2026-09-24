/**
 * Helpers used by more than one POI route handler.
 * Pure moves out of the former `src/handlers.ts` (BRAWUKA-549) — no behavior
 * change, call sites keep their original comments at the route that owns them.
 */

import { json } from "../auth";
import { UpstreamApiError } from "../upstream";

export function upstreamError(request: Request, e: unknown): Response {
  if (e instanceof UpstreamApiError) {
    // P0 scrub: the upstream `message` can carry the request URL (embeds
    // `key=`) or echoed body text — never relay it. True parse/validation
    // failures (bad input shape, unparseable candidate) are
    // `invalid_upstream`; quota exhaustion (429), key denial (403), and
    // other dependency failures stay `upstream_error` so the D8
    // `upstream_error` spike alert sees them.
    if (e.status === 400 || e.status === 404) {
      return json({ error: "invalid_upstream" }, 502, request);
    }
    return json({ error: "upstream_error" }, 502, request);
  }
  return json({ error: "upstream_error" }, 502, request);
}

/**
 * Session token shape. Google requires a UUID and treats anything else as
 * "no session" — which silently reverts every Autocomplete request in the
 * session to per-request billing. Rejecting a malformed token here is
 * therefore a cost guard, not a formality.
 */
export const SESSION_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inLatRange(lat: number): boolean {
  return lat >= -90 && lat <= 90;
}

export function inLngRange(lng: number): boolean {
  return lng >= -180 && lng <= 180;
}

export function parseQueryNumber(value: string | null): number {
  return value === null || value.trim() === "" ? NaN : Number(value);
}
