import "server-only";

/**
 * Standard parse result shape for lib/validation/* validators (spec 0009, spec 0011).
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function fail<T>(message: string): ParseResult<T> {
  return { ok: false, message };
}

/**
 * C0/C1 control characters are never part of a search keyword, and a NUL byte
 * in particular cannot survive the trip into Postgres: it arrives as a text
 * bind parameter and fails the whole statement with
 * `invalid byte sequence for encoding "UTF8": 0x00` (BRAWUKA-973/975).
 * `\p{Cc}` covers U+0000–U+001F and U+007F–U+009F; it deliberately leaves
 * format characters alone so emoji ZWJ sequences in a keyword are untouched.
 *
 * One rule, every search surface: `GET /api/search` (deep-link validation in
 * `lib/search/search-params.ts`) and the POI proxy routes
 * (`GET /api/places/search`, `GET /api/places/autocomplete`) reject through
 * this predicate before Postgres or the worker ever sees the value.
 */
const CONTROL_CHARS_RE = /[\p{Cc}]/u;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS_RE.test(value);
}
