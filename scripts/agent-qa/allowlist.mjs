/**
 * Agent-QA URL allowlist guard (BRAWUKA-408).
 *
 * The agent browser may navigate ONLY to staging surfaces: the app, the image
 * CDN, the staging Supabase project, and the Cloudflare Access handshake
 * hosts. Anything else aborts the run — this is what keeps a confused agent
 * off production and off the open web. Production (`cafemood.app`) is
 * deliberately absent: no rule here may ever match it.
 */

export const AGENT_QA_ALLOWED_HOSTS = Object.freeze([
  "staging.cafemood.app",
  "staging-images.cafemood.app",
  "ojujmjewtbquiddswyrg.supabase.co",
  "*.cloudflareaccess.com",
]);

/**
 * @param {unknown} hostname hostname to check (case-insensitive, trailing dot tolerated)
 * @returns {boolean} true when an allowlist rule matches
 */
export function isAllowedHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/\.+$/, "");
  if (host === "") return false;
  return AGENT_QA_ALLOWED_HOSTS.some((rule) => {
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1).toLowerCase();
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === rule.toLowerCase();
  });
}

/**
 * @param {unknown} candidate absolute URL to check
 * @returns {boolean} true only for http(s) URLs on an allowed host
 */
export function isAllowedUrl(candidate) {
  let url;
  try {
    url = new URL(String(candidate));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isAllowedHost(url.hostname);
}

/**
 * Navigation gate: return the URL unchanged when allowed, otherwise throw —
 * callers abort the run on this error. The message names the offending host
 * so a blocked run is triageable from the log alone.
 *
 * @param {unknown} candidate absolute URL the agent wants to navigate to
 * @returns {string} the URL, unchanged
 */
export function assertAllowedUrl(candidate) {
  if (!isAllowedUrl(candidate)) {
    let host = String(candidate);
    try {
      host = new URL(String(candidate)).hostname || String(candidate);
    } catch {
      /* keep the raw candidate */
    }
    throw new Error(
      `Agent-QA navigation blocked: host "${host}" is outside the staging allowlist (${AGENT_QA_ALLOWED_HOSTS.join(", ")}).`,
    );
  }
  return String(candidate);
}
