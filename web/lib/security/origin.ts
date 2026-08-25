/**
 * Origin and CSRF validation for mutating HTTP requests (Issue #208).
 *
 * Checks `Sec-Fetch-Site` and `Origin` headers on state-changing methods
 * (POST, PATCH, PUT, DELETE) to protect cookie-authenticated sessions
 * from cross-site request forgery.
 */

export function isSameOrigin(request: Request): boolean {
  // 1. Inspect Sec-Fetch-Site if provided by modern browsers
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  // 2. Extract expected host from request headers
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (host) {
        // Compare hostnames/ports
        if (originUrl.host.toLowerCase() === host.toLowerCase()) {
          return true;
        }
      }

      // Check against configured site URL if set
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      if (siteUrl) {
        try {
          const siteOriginUrl = new URL(siteUrl);
          if (originUrl.host.toLowerCase() === siteOriginUrl.host.toLowerCase()) {
            return true;
          }
        } catch {
          // Ignore malformed env site URL
        }
      }

      // If Origin is present but matches neither request host nor site URL -> reject
      return false;
    } catch {
      // Malformed Origin header
      return false;
    }
  }

  // 3. Fallback: inspect Referer header if Origin is absent
  const referer = request.headers.get("referer");
  if (referer && host) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host.toLowerCase() !== host.toLowerCase()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  // 4. If no Origin or Referer and not Sec-Fetch-Site: cross-site -> allow (e.g. server-to-server or non-browser)
  return true;
}
