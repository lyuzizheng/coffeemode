/**
 * Baseline security response headers (BRAWUKA-633).
 *
 * Single source of truth for Content-Security-Policy and Permissions-Policy,
 * consumed by `next.config.ts` `headers()` and pinned by
 * `tests/security/headers.test.ts`.
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

/** Build the Content-Security-Policy value. `isProduction` gates upgrade-insecure-requests + the MinIO exception. */
export function contentSecurityPolicy(isProduction: boolean): string {
  const dev = isProduction ? "" : ` ${DEV_EXTRA}`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${SCRIPT_SRC_EXTRA}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${IMG_SRC_EXTRA}${dev}`,
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_SRC_EXTRA}${dev}`,
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
export function securityHeaders(isProduction: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isProduction) },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}
