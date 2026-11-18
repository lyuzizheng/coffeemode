/**
 * Baseline security response headers (BRAWUKA-633).
 *
 * Single source of truth for Content-Security-Policy and Permissions-Policy,
 * consumed by `next.config.ts` `headers()`.
 *
 * Import-free by construction (like `lib/cache-policy.ts` and
 * `lib/images/constants.ts`): `next.config.ts` runs through Next's config
 * transpiler, which cannot resolve module imports outside the file itself.
 *
 * External-host inventory (what the browser actually loads):
 * - `cdn.apple-mapkit.com` — MapKit JS SDK script (place search).
 * - `api.apple-mapkit.com` — MapKit JS bootstrap-driven search/geocode API
 *   base; `gsp10.apple-mapkit.com` — SDK analytics endpoint (keeps consoles
 *   clean); `maps-api.apple.com` — server-side Apple Maps REST host.
 * - `challenges.cloudflare.com` — Cloudflare Turnstile widget/frame.
 * - `tiles.openfreemap.org` — MapLibre vector tiles + glyph PBFs
 *   (style docs are same-origin `/map/*.json`; glyphs/tiles remote).
 * - R2 image CDN hosts (`*.cafemood.app` public hosts, Google OAuth avatar
 *   URLs pass through the R2 loader untouched when absolute).
 * - `*.r2.cloudflarestorage.com` — presigned photo PUTs: prod/staging sign
 *   against `https://<account>.r2.cloudflarestorage.com` (image-service
 *   `R2_ENDPOINT=""`), so the browser PUTs cross-origin (client-upload.ts).
 * - Cloudflare Web Analytics beacon (BRAWUKA-815, BRAWUKA-981) —
 *   `static.cloudflareinsights.com` serves `beacon.min.js` and the beacon
 *   reports to `cloudflareinsights.com`. Cloudflare injects it at the zone
 *   edge (`auto_install`), and that switch is per zone, not per hostname: the
 *   staging deploy receives the beacon exactly like the production deploy
 *   does. Both deployed environments therefore grant the two hosts. `APP_ENV`
 *   is the deploy discriminator — staging is also a `NODE_ENV=production`
 *   build — and local/CI builds leave it unset, so their policy stays closed.
 * - `blob:` — draft photo previews + canvas-resize source via
 *   `URL.createObjectURL` (checkin-photos, checkin-resume, toWebP).
 * - `http://localhost:9000` (non-production only) — local MinIO presign
 *   target and image host.
 * - Supabase Auth: client only calls same-origin `/api/*` routes; the
 *   realtime/WebSocket path is unused, so no `wss:` exception is granted.
 *
 * CSP notes:
 * - `script-src 'self' 'unsafe-inline'` plus the MapKit/Turnstile hosts.
 *   `'unsafe-inline'` is required: Next.js App Router emits inline bootstrap
 *   scripts (hydration/RSC payload) and there is no nonce pipeline — `'self'`
 *   alone would break the app. `'unsafe-eval'` is NOT granted.
 * - The Cloudflare beacon adds exactly two hosts (`script-src` +
 *   `connect-src`) on a deployed environment; the rest of the policy never
 *   widens for analytics.
 * - `style-src 'self' 'unsafe-inline'` — Tailwind + next-intl emit inline
 *   `<style>` blocks; no remote stylesheets are used (fonts are self-hosted
 *   via `next/font/local`).
 * - `img-src` includes `data:` (MapLibre pin canvas `data:image/svg+xml`),
 *   `blob:` (draft photo previews), plus the R2/Turnstile/MapKit hosts;
 *   Google OAuth avatar URLs pass through when absolute
 *   (`lh3.googleusercontent.com` covers the Google-sign-in avatar case).
 * - `frame-src` is Turnstile-only (challenge iframe) — no YouTube/Vimeo
 *   embeds exist. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
 *   close plugin/form exfiltration. `frame-ancestors 'self'`
 *   mirrors the existing `X-Frame-Options: SAMEORIGIN`.
 */

/** Hosts the browser may load scripts from (MapKit SDK + Turnstile widget). */
const SCRIPT_SRC_EXTRA = "https://cdn.apple-mapkit.com https://challenges.cloudflare.com";

/** Hosts `connect-src` allows: map tiles + MapKit API + Turnstile + R2 PUTs. */
const CONNECT_SRC_EXTRA =
  "https://tiles.openfreemap.org https://cdn.apple-mapkit.com https://api.apple-mapkit.com " +
  "https://gsp10.apple-mapkit.com https://maps-api.apple.com https://challenges.cloudflare.com " +
  "https://*.r2.cloudflarestorage.com";

/** Hosts `img-src` allows beyond `'self' data: blob:` (R2 CDN + avatars + tiles). */
const IMG_SRC_EXTRA =
  "https://images.cafemood.app https://staging-images.cafemood.app " +
  "https://tiles.openfreemap.org https://lh3.googleusercontent.com " +
  "https://cdn.apple-mapkit.com https://challenges.cloudflare.com";

/** Local MinIO origin — dev-only exception for presign PUTs and image serving. */
const DEV_EXTRA = "http://localhost:9000";

/**
 * Cloudflare Web Analytics beacon hosts. The zone edge injects the beacon
 * into every hostname of the zone, so every deployed environment needs the
 * exception; local and CI builds have no edge in front of them.
 */
const CLOUDFLARE_BEACON_SCRIPT_SRC = "https://static.cloudflareinsights.com";
const CLOUDFLARE_BEACON_CONNECT_SRC = "https://cloudflareinsights.com";

/** `APP_ENV` values served through the Cloudflare zone edge (`auto_install`). */
const BEACON_APP_ENVS: Record<string, true> = { production: true, staging: true };

/**
 * Whether the policy should grant the Cloudflare Web Analytics beacon hosts.
 *
 * The injection switch lives in the Cloudflare dashboard at zone level, so it
 * cannot be read at build time and it covers staging as well as production
 * (BRAWUKA-981). Keying the exception on the deploy environment mirrors what
 * the edge actually does; a narrower gate silently breaks staging with CSP
 * violations on every page load.
 */
export function cloudflareBeaconAllowed(appEnv: string | undefined): boolean {
  const env = appEnv?.trim();
  return env !== undefined && BEACON_APP_ENVS[env] === true;
}

/**
 * Build the Content-Security-Policy value.
 *
 * @param isProduction `NODE_ENV === "production"` — gates
 *   `upgrade-insecure-requests` and the MinIO exception.
 * @param allowCloudflareBeacon `cloudflareBeaconAllowed(APP_ENV)` — grants the
 *   Cloudflare Web Analytics beacon hosts.
 */
export function contentSecurityPolicy(
  isProduction: boolean,
  allowCloudflareBeacon = false,
): string {
  const dev = isProduction ? "" : ` ${DEV_EXTRA}`;
  const beaconScript = allowCloudflareBeacon ? ` ${CLOUDFLARE_BEACON_SCRIPT_SRC}` : "";
  const beaconConnect = allowCloudflareBeacon ? ` ${CLOUDFLARE_BEACON_CONNECT_SRC}` : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${SCRIPT_SRC_EXTRA}${beaconScript}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${IMG_SRC_EXTRA}${dev}`,
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_SRC_EXTRA}${beaconConnect}${dev}`,
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  if (isProduction) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Permissions-Policy value. Only `geolocation` is granted (onboarding locate
 * button + discovery user-location dot, both behind explicit user taps).
 * Camera, microphone, payment, USB, and other powerful features stay denied —
 * no surface in the app uses them.
 */
export const PERMISSIONS_POLICY = "geolocation=(self), camera=(), microphone=(), payment=()";

/** Header name/value pairs the `/:path*` baseline block in `next.config.ts` must set. */
export function securityHeaders(
  isProduction: boolean,
  allowCloudflareBeacon = false,
): { key: string; value: string }[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(isProduction, allowCloudflareBeacon),
    },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}
