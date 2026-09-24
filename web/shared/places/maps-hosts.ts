/**
 * Maps share-link host allowlist — single source of truth (BRAWUKA-429).
 *
 * Consumed by the web route validator (`web/lib/places/validate-maps-url.ts`,
 * issue #37 — validates before proxying) and the POI worker
 * (`poi-service/src/url.ts` — re-validates the initial URL and every
 * redirect target itself).
 *
 * Keep this file free of runtime dependencies so every package can import
 * it (Next.js web app, Cloudflare Workers, vitest).
 *
 * - Exact hosts: Google's two short-link domains and Apple Maps' web hosts
 *   (including Apple's shortened `maps.apple` host).
 * - Regional Google domains: `google.com`, `google.<ccTLD>` (optionally
 *   `www.`/`maps.` prefixed), and two-label ccTLD forms with a known
 *   second-level (`google.co.uk`, `google.com.sg`). This admits
 *   `www.google.com`, `maps.google.de` while rejecting non-map subdomains
 *   (`drive.google.com`), suffix-lookalikes (`google.com.evil.com`), and
 *   attacker-registrable TLD shapes (`google.evil.io`, `google.zip`).
 */
const EXACT_MAPS_HOSTS: Record<string, true> = {
  "goo.gl": true,
  "maps.app.goo.gl": true,
  "maps.apple": true,
  "maps.apple.com": true,
};

const GOOGLE_MAPS_HOST_RE =
  /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|(?:com|co|org|net|ac|gov|edu)\.[a-z]{2})$/;

/** True for hosts treated as Google/Apple Maps pages (case-insensitive). */
export function isMapsHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return EXACT_MAPS_HOSTS[h] === true || GOOGLE_MAPS_HOST_RE.test(h);
}
