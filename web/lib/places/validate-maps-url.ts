/**
 * Allowed Maps share-link hosts (issue #37).
 *
 * The host allowlist lives in `@shared/places/maps-hosts` (BRAWUKA-429),
 * shared with `isMapsHost` in `poi-service/src/url.ts` — the worker
 * re-validates with the same semantics after redirects.
 */
import { isMapsHost } from "@shared/places/maps-hosts";

/**
 * Returns true when `mapsShareUrl` is a valid HTTPS URL whose hostname is an
 * allowed Google Maps or Apple Maps host (regional Google domains included).
 */
export function isValidMapsUrl(mapsShareUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(mapsShareUrl);
  } catch {
    // Benign: malformed URL string is not a valid maps URL.
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  return isMapsHost(url.hostname);
}
