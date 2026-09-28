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
