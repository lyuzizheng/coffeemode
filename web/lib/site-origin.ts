import "server-only";

import { headers } from "next/headers";

/**
 * The canonical public origin for absolute URLs (canonical links, og:url,
 * og:image, sitemap, JSON-LD). `NEXT_PUBLIC_SITE_URL` is the source of truth
 * once the owner configures it (docs/agent/pending-user-actions); until then
 * the origin derives from the request so local dev and pre-domain deploys
 * still produce working absolute URLs. DG110: one canonical URL per cafe —
 * set NEXT_PUBLIC_SITE_URL before production traffic so shared links never
 * depend on which host served them.
 */
export async function getRequestOrigin(): Promise<string> {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Malformed env falls through to the request-derived origin below.
    }
  }
  const h = await headers();
  // No trusted edge yet with `Host`-only: without a CDN/reverse-proxy in front,
  // `Host` is also client-controllable, so pre-domain / local-dev fallbacks here
  // could in principle mint canonical/OG URLs for an arbitrary host. We still prefer
  // `host` over `x-forwarded-host` (the latter is always injection-prone and never
  // set by Cloudflare), and production MUST pin `NEXT_PUBLIC_SITE_URL` (DG110) so
  // shared links never depend on which host served them; the fallback is dev-only.
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";
  const host = h.get("host");
  if (host) return `${proto === "http" ? "http" : "https"}://${host}`;
  return "http://localhost:3000";
}
