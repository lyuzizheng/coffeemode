/**
 * Allowed Maps share-link hosts (issue #37).
 *
 * Keep in sync with `isMapsHost` in `poi-service/src/url.ts` — the worker
 * re-validates with the same semantics after redirects.
 *
 * - Exact hosts: Google's two short-link domains and Apple Maps' web host.
 * - Regional Google domains: `google.com`, `google.<ccTLD>` (optionally
 *   `www.`/`maps.` prefixed), and two-label ccTLD forms with a known
 *   second-level (`google.co.uk`, `google.com.sg`). This admits
 *   `www.google.com`, `maps.google.de` while rejecting non-map subdomains
 *   (`drive.google.com`), suffix-lookalikes (`google.com.evil.com`), and
 *   attacker-registrable TLD shapes (`google.evil.io`, `google.zip`).
 */
const EXACT_MAPS_HOSTS = new Set(["goo.gl", "maps.app.goo.gl", "maps.apple.com"]);
const GOOGLE_MAPS_HOST_RE =
  /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|(?:com|co|org|net|ac|gov|edu)\.[a-z]{2})$/;

/**
 * Returns true when `mapsShareUrl` is a valid HTTPS URL whose hostname is an
 * allowed Google Maps or Apple Maps host (regional Google domains included).
 */
export function isValidMapsUrl(mapsShareUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(mapsShareUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return EXACT_MAPS_HOSTS.has(hostname) || GOOGLE_MAPS_HOST_RE.test(hostname);
}
