import "server-only";

/**
 * Minimal server logger (BRAWUKA-168).
 *
 * One JSON line per error on stderr: `{type:"error", request_id, route,
 * message}`. `request_id` comes from the `x-request-id` header minted in
 * `web/proxy.ts`, so error lines correlate with access-log lines. No SaaS,
 * no levels beyond error — Cloudflare Observability covers the edge.
 */

export const REQUEST_ID_HEADER = "x-request-id";
export function logError(
  route: string,
  err: unknown,
  request?: Request,
): void {
  console.error(
    JSON.stringify({
      type: "error",
      request_id: request?.headers.get(REQUEST_ID_HEADER) ?? null,
      route,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}
