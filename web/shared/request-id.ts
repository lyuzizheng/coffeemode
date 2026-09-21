/**
 * Request-id primitives shared by the Next.js app and both Cloudflare
 * Workers (spec 0011 D6/D7, BRAWUKA-536). Dependency-free so it runs on
 * Workers and under vitest/Node.
 *
 * One id per request: the proxy (or an upstream caller) sets `x-request-id`;
 * handlers reuse a valid inbound value so access and error lines correlate,
 * and generate a fresh UUID when it is missing or forged.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Request-id for a handler. Reuses a valid inbound `x-request-id`; generates
 * a fresh id when the header is missing/invalid or no request is in scope —
 * e.g. the `/api/health` route the proxy matcher skips, direct worker hits,
 * or lib code without request context.
 */
export function getRequestId(request?: { headers: Headers }): string {
  const inbound = request?.headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(inbound) ? inbound : crypto.randomUUID();
}
