import { NextResponse } from "next/server";

/**
 * Origin and CSRF validation for mutating HTTP requests (Issues #208, #218).
 *
 * Single source of truth for host allowlisting across auth actions and
 * mutating route handlers. Checks `Sec-Fetch-Site`, `Origin`, and `Referer`
 * headers to protect cookie-authenticated sessions from cross-site request forgery.
 */

const ALLOWED_SCHEMES = ["http:", "https:"];
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Returns the normalized origin from NEXT_PUBLIC_SITE_URL or null if not configured. */
export function getConfiguredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Parses a host allowlist entry (e.g. "staging.coffeemode.app:3000" or "https://staging.coffeemode.app"). */
export function parseAllowlistEntry(entry: string): { host: string; hostname: string } | null {
  let hostPart = entry;

  if (entry.includes("://") || entry.startsWith("//")) {
    try {
      hostPart = new URL(entry.startsWith("//") ? `http:${entry}` : entry).host;
    } catch {
      return null;
    }
  }

  if (!hostPart || /[/?#]/.test(hostPart)) return null;

  try {
    const url = new URL(`http://${hostPart}`);
    return { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Computes the set of allowed hosts from NEXT_PUBLIC_SITE_URL and
 * NEXT_PUBLIC_ALLOWED_HOSTS.
 */
export function getAllowedHosts(): Set<string> {
  const allowed = new Set<string>();

  const configured = getConfiguredOrigin();
  if (configured) {
    try {
      allowed.add(new URL(configured).host.toLowerCase());
    } catch {
      // Malformed configured origin is ignored.
    }
  }

  const extra = process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
  if (extra) {
    for (const entry of extra.split(",")) {
      const parsed = parseAllowlistEntry(entry.trim());
      if (parsed) allowed.add(parsed.host);
    }
  }

  return allowed;
}

/** Checks whether a host/hostname is allowed by configuration or localhost fallback. */
function isAllowedHost(host: string, hostname?: string): boolean {
  const cleanHost = host.toLowerCase();
  const cleanHostname = (hostname ?? cleanHost.split(":")[0]).toLowerCase();
  const allowed = getAllowedHosts();
  if (allowed.size > 0) {
    return allowed.has(cleanHost);
  }
  return LOCALHOST_HOSTNAMES.has(cleanHostname);
}

/** Checks whether a full origin string (protocol + host) is allowed. */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) return false;
  return isAllowedHost(url.host, url.hostname);
}

/** Extracts the effective host from request headers, handling comma-separated forwarded hosts. */
function getEffectiveHost(headers: Headers): string | null {
  const rawForwarded = headers.get("x-forwarded-host");
  if (rawForwarded) {
    const first = rawForwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("host");
}

/** Reconstructs proto + host origin for OAuth redirects. */
export function getProtoHost(requestHeaders: Headers): string | null {
  const rawProto = requestHeaders.get("x-forwarded-proto");
  const proto = rawProto === "http" ? "http" : "https";
  const host = getEffectiveHost(requestHeaders);
  if (!host) return null;

  const cleanHost = host.replace(/^https?:\/\//, "");
  if (!cleanHost) return null;

  try {
    const url = new URL(`${proto}://${cleanHost}`);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Checks whether an incoming request matches the expected origin.
 *
 * 1. Rejects if modern browser `Sec-Fetch-Site` is `cross-site`.
 * 2. Compares `Origin` header against request host and allowlist.
 * 3. Falls back to `Referer` header if `Origin` is omitted.
 * 4. Allows requests without `Origin` or `Referer` (e.g. non-browser API client).
 */
export function isSameOrigin(request: Request): boolean {
  // 1. Inspect Sec-Fetch-Site if provided by modern browsers
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  // 2. Extract expected host from request headers
  const host = getEffectiveHost(request.headers);

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!ALLOWED_SCHEMES.includes(originUrl.protocol)) {
        return false;
      }
      if (host && originUrl.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      return isAllowedHost(originUrl.host, originUrl.hostname);
    } catch {
      // Malformed Origin header
      return false;
    }
  }

  // 3. Fallback: inspect Referer header if Origin is absent
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (!ALLOWED_SCHEMES.includes(refererUrl.protocol)) {
        return false;
      }
      if (host && refererUrl.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      return isAllowedHost(refererUrl.host, refererUrl.hostname);
    } catch {
      return false;
    }
  }

  // 4. If no Origin or Referer and not Sec-Fetch-Site: cross-site -> allow (e.g. non-browser API client)
  return true;
}

/**
 * Helper that returns a 403 Response if the request is cross-origin, or null if allowed.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "forbidden_origin", message: "cross-origin request forbidden" },
      { status: 403 },
    );
  }
  return null;
}
