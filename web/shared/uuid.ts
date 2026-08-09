/**
 * Shared UUID validation — the single source of truth for web/ and the
 * worker services. Keep this file free of runtime dependencies so every
 * package can import it (Next.js web app, Cloudflare Workers, vitest).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a UUID v4 string. Type guard: non-strings are rejected, so a
 * caller with an `unknown` body value can narrow safely.
 */
export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
