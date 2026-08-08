/**
 * Allowed Maps share-link hosts.
 *
 * The check accepts the exact host and any subdomain, so `www.google.com`,
 * `maps.google.com`, and `foo.maps.google.com` all pass.
 */
const ALLOWED_MAPS_HOSTS = [
  "google.com",
  "maps.google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "apple.com",
  "maps.apple.com",
];

/**
 * Returns true when `mapsShareUrl` is a valid HTTP(S) URL whose hostname is
 * an allowed Google Maps or Apple Maps domain (or a subdomain of one).
 */
export function isValidMapsUrl(mapsShareUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(mapsShareUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return ALLOWED_MAPS_HOSTS.some(
    (base) => hostname === base || hostname.endsWith(`.${base}`),
  );
}
