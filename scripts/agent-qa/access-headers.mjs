/**
 * Agent-QA Cloudflare Access injection (BRAWUKA-408).
 *
 * Staging sits behind a Cloudflare Access application, so every browser page
 * and every scaffold HTTP call carries the service-token pair. The secret
 * names follow the staging-journey convention (`CF_ACCESS_CLIENT_ID` /
 * `CF_ACCESS_CLIENT_SECRET`, see `.github/workflows/staging-journey.yml`).
 *
 * Fail-closed: unset variables throw — the run aborts before touching staging
 * instead of probing it unauthenticated. The pair returned here is a
 * network-layer identity only; it grants no in-app privilege and never
 * includes the Supabase `service_role` key (that key stays server-side in
 * `web/tests/agent-qa/session.ts` and must never reach a prompt, page, or
 * client bundle).
 */

export const ACCESS_CLIENT_ID_ENV = "CF_ACCESS_CLIENT_ID";
export const ACCESS_CLIENT_SECRET_ENV = "CF_ACCESS_CLIENT_SECRET";

export const ACCESS_CLIENT_ID_HEADER = "CF-Access-Client-Id";
export const ACCESS_CLIENT_SECRET_HEADER = "CF-Access-Client-Secret";

/**
 * Read the Access service-token pair. Throws listing every missing variable —
 * never defaults, never proceeds half-configured.
 *
 * @param {Record<string, string | undefined>} [env] env source (default: process.env)
 * @returns {{ clientId: string, clientSecret: string }}
 */
export function resolveAccessHeaders(env = process.env) {
  const clientId = env[ACCESS_CLIENT_ID_ENV];
  const clientSecret = env[ACCESS_CLIENT_SECRET_ENV];
  const missing = [
    !clientId ? ACCESS_CLIENT_ID_ENV : null,
    !clientSecret ? ACCESS_CLIENT_SECRET_ENV : null,
  ].filter((entry) => entry !== null);
  if (missing.length > 0) {
    throw new Error(`Agent-QA Cloudflare Access is not configured. Missing: ${missing.join(", ")}.`);
  }
  return { clientId, clientSecret };
}

/**
 * DEPRECATED (BRAWUKA-508): `Network.setExtraHTTPHeaders` attaches headers to
 * EVERY request the page makes, leaking the `CF-Access-*` service token to
 * third-party origins (F6). Use `scripts/agent-qa/access-inject.mjs`
 * (`buildAccessFetchPatterns` + `createAccessRequestPump`, Fetch domain with
 * allowlist-scoped patterns) instead — per-origin injection only. These two
 * shape helpers remain for scaffold-side direct HTTP calls (curl/fetch to
 * staging URLs the caller already allowlisted), never for browser injection.
 *
 * @param {{ clientId: string, clientSecret: string }} pair
 */
export function toCdpExtraHeaders({ clientId, clientSecret }) {
  return {
    headers: {
      [ACCESS_CLIENT_ID_HEADER]: clientId,
      [ACCESS_CLIENT_SECRET_HEADER]: clientSecret,
    },
  };
}

/**
 * Header shape for scaffold-side direct HTTP calls to staging
 * (see `toCdpExtraHeaders` deprecation note above).
 *
 * @param {{ clientId: string, clientSecret: string }} pair
 */
export function toPlaywrightExtraHeaders({ clientId, clientSecret }) {
  return {
    [ACCESS_CLIENT_ID_HEADER]: clientId,
    [ACCESS_CLIENT_SECRET_HEADER]: clientSecret,
  };
}
