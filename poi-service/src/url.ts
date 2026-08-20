/**
 * Google and Apple Maps share-URL parsing.
 *
 * Handles the formats users actually paste when creating a cafe:
 *   - https://www.google.com/maps/place/<name>/@lat,lng,zoom/data=!4m...!1s0x..:0x..!8m2!3d..!4d..
 *   - https://www.google.com/maps/place/<name>/data=!4m...!1s0x..:0x..!8m2!3d..!4d..
 *   - https://maps.app.goo.gl/<code>          (short link → follow redirects)
 *   - https://www.google.com/maps?q=<query>
 *   - https://www.google.com/maps/search/<query>/@lat,lng,zoom
 *   - https://maps.google.com/?q=lat,lng
 *   - https://maps.apple.com/?auid=<id>&ll=lat,lng&q=<name>
 */

export interface ResolvedTarget {
  source?: "google" | "apple";
  placeId?: string;
  coords?: { lat: number; lng: number };
  query?: string;
}

const PLACE_ID_RE = /(?:!1s|(?:^|[&?;])1s)(0x[0-9a-fA-F]+(?::0x[0-9a-fA-F]+)?)/;
const CHIJ_RE = /ChIJ[0-9A-Za-z_-]{20,}/;
const AT_COORDS_RE = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
const EXCL_COORDS_RE = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/;
const Q_PARAM_RE = /[?&]q=([^&]+)/;
const SEARCH_PATH_RE = /\/maps\/search\/([^/@?]+)/;
const PLACE_SLUG_RE = /\/maps\/place\/([^/@?]+)/;
const APPLE_COORDS_PARAMS = ["ll", "coordinate"] as const;
const APPLE_PLACE_ID_PARAMS = ["auid", "place-id", "place_id"] as const;

const SHORT_HOSTS = new Set(["goo.gl", "maps.app.goo.gl", "maps.apple"]);

// Keep in sync with `isValidMapsUrl` in `web/lib/places/validate-maps-url.ts`
// (issue #37) — the web route validates before proxying; the worker
// re-validates the initial URL and every redirect target itself.
const EXACT_MAPS_HOSTS = new Set(["goo.gl", "maps.app.goo.gl", "maps.apple", "maps.apple.com"]);
const APPLE_MAPS_HOSTS = new Set(["maps.apple", "maps.apple.com"]);
// google.com, google.<ccTLD>, or google.<known second-level>.<cc> — wide enough
// for regional domains, tight enough to exclude attacker-registrable TLD
// shapes like google.evil.io or google.zip.
const GOOGLE_MAPS_HOST_RE =
  /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|(?:com|co|org|net|ac|gov|edu)\.[a-z]{2})$/;

/** True for hosts we treat as Google/Apple Maps pages (regional google.* included). */
export function isMapsHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return EXACT_MAPS_HOSTS.has(h) || GOOGLE_MAPS_HOST_RE.test(h);
}

/** Max redirect hops followed when resolving short links. */
export const MAX_REDIRECT_HOPS = 5;

export function isShortLink(urlStr: string): boolean {
  try {
    return SHORT_HOSTS.has(new URL(urlStr).hostname);
  } catch {
    return false;
  }
}

export function extractPlaceId(urlStr: string): string | null {
  const hex = urlStr.match(PLACE_ID_RE)?.[1];
  if (hex) return hex;
  return urlStr.match(CHIJ_RE)?.[0] ?? null;
}

/** Apple Maps share links expose their stable POI reference as `auid` on
 * current links and `place-id` on some newer web links. */
export function extractApplePlaceId(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (!APPLE_MAPS_HOSTS.has(url.hostname.toLowerCase())) return null;
    for (const param of APPLE_PLACE_ID_PARAMS) {
      const value = url.searchParams.get(param)?.trim();
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

function parseCoordinatePair(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => Number.parseFloat(part.trim()));
  if (
    parts.length < 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1]) ||
    parts[0] < -90 ||
    parts[0] > 90 ||
    parts[1] < -180 ||
    parts[1] > 180
  ) {
    return null;
  }
  return { lat: parts[0], lng: parts[1] };
}

export function extractAppleCoords(urlStr: string): { lat: number; lng: number } | null {
  try {
    const url = new URL(urlStr);
    if (!APPLE_MAPS_HOSTS.has(url.hostname.toLowerCase())) return null;
    for (const param of APPLE_COORDS_PARAMS) {
      const coords = parseCoordinatePair(url.searchParams.get(param));
      if (coords) return coords;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractAppleQuery(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (!APPLE_MAPS_HOSTS.has(url.hostname.toLowerCase())) return null;
    for (const param of ["q", "name", "address"]) {
      const value = url.searchParams.get(param)?.trim();
      if (value) return value;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractCoords(urlStr: string): { lat: number; lng: number } | null {
  const at = urlStr.match(AT_COORDS_RE);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const excl = urlStr.match(EXCL_COORDS_RE);
  if (excl) return { lat: parseFloat(excl[1]), lng: parseFloat(excl[2]) };
  // maps.google.com/?q=lat,lng
  const q = urlStr.match(Q_PARAM_RE)?.[1];
  if (q) {
    const parts = decodeURIComponent(q).split(",").map(parseFloat);
    if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
      return { lat: parts[0], lng: parts[1] };
    }
  }
  return null;
}

export function extractQuery(urlStr: string): string | null {
  const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " ")).trim();
  const q = urlStr.match(Q_PARAM_RE)?.[1];
  if (q) return decode(q);
  const search = urlStr.match(SEARCH_PATH_RE)?.[1];
  if (search) return decode(search);
  const slug = urlStr.match(PLACE_SLUG_RE)?.[1];
  if (slug) return decode(slug.replace(/-/g, " "));
  return null;
}

/** Parse a Maps URL without network calls. */
export function parseMapsUrl(urlStr: string): ResolvedTarget {
  try {
    const url = new URL(urlStr);
    if (APPLE_MAPS_HOSTS.has(url.hostname.toLowerCase())) {
      return {
        source: "apple",
        placeId: extractApplePlaceId(urlStr) ?? undefined,
        coords: extractAppleCoords(urlStr) ?? undefined,
        query: extractAppleQuery(urlStr) ?? undefined,
      };
    }
  } catch {
    return {};
  }
  const placeId = extractPlaceId(urlStr);
  if (placeId) return { source: "google", placeId };
  const coords = extractCoords(urlStr);
  const query = extractQuery(urlStr);
  return { source: "google", coords: coords ?? undefined, query: query ?? undefined };
}

function htmlAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function applePageMeta(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (htmlAttribute(tag, "property") !== property) continue;
    const content = htmlAttribute(tag, "content");
    if (content) return decodeHtml(content).trim();
  }
  return null;
}

function enrichAppleTargetFromPage(target: ResolvedTarget, html: string): ResolvedTarget {
  const coords = parseCoordinatePair(
    [applePageMeta(html, "place:location:latitude"), applePageMeta(html, "place:location:longitude")]
      .filter((value): value is string => value !== null)
      .join(","),
  );
  return {
    ...target,
    coords: coords ?? target.coords,
    query: target.query ?? applePageMeta(html, "og:title") ?? undefined,
  };
}

async function resolveApplePlacePage(
  current: string,
  target: ResolvedTarget,
  fetchImpl: typeof fetch,
): Promise<ResolvedTarget> {
  const response = await fetchImpl(current, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "text/html" },
  }).catch(() => undefined);
  if (!response?.ok) return target;
  return enrichAppleTargetFromPage(target, await response.text());
}

/**
 * Resolve a share URL to a target, following short-link redirects
 * (≤ MAX_REDIRECT_HOPS hops). The initial URL and every redirect target must
 * be https URLs on an allowed Maps host (issue #37) — anything else stops
 * resolution and yields whatever was parsed so far, so a short link cannot
 * bounce the worker to an arbitrary host embedding a fake place id.
 */
export async function resolveShareUrl(
  urlStr: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedTarget> {
  let current: string;
  try {
    const initial = new URL(urlStr);
    if (initial.protocol !== "https:" || !isMapsHost(initial.hostname)) return {};
    current = initial.toString();
  } catch {
    return {};
  }
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const parsed = parseMapsUrl(current);
    if (parsed.source === "apple" && parsed.placeId && !parsed.coords) {
      return await resolveApplePlacePage(current, parsed, fetchImpl);
    }
    if (parsed.placeId) return parsed;
    if (!isShortLink(current)) return parsed;

    const res = await fetchImpl(current, { method: "HEAD", redirect: "manual" }).catch(
      () => undefined,
    );
    const location = res?.headers.get("location");
    if (!location) return parsed;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return parsed; // malformed Location header — stop, don't 500
    }
    if (next.protocol !== "https:" || !isMapsHost(next.hostname)) return parsed;
    current = next.toString();
  }
  return parseMapsUrl(current);
}
