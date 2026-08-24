/**
 * Public CDN host for processed image variants.
 *
 * The image-service Worker uploads `original`, `card`, and `thumbnail` WebP
 * variants to R2; this host is served through Cloudflare and cached as
 * immutable by both the CDN and the service worker.
 *
 * This constant is the single source of truth (issue #40). It cannot be
 * derived from env at module scope: this module is bundled into the
 * service worker, and the serwist build keeps `process.env.*` as a runtime
 * reference — `process` is undefined in a worker, so an env read would break
 * SW install (verified empirically). Instead, `next.config.ts` calls
 * `assertR2PublicUrlMatches` so setting `NEXT_PUBLIC_R2_PUBLIC_URL` to a
 * drifted host fails the build loudly instead of silently desyncing the
 * loader / SW cache matcher / remotePatterns. The worker's own
 * `R2_PUBLIC_URL` (image-service/wrangler.toml) must point at the same
 * origin — two deploy-time configs for one host.
 *
 * This module must stay free of imports (even relative ones): `next.config.ts`
 * imports it, and Next's config transpiler cannot resolve TypeScript modules
 * outside the file itself. The shared upload cap lives in
 * `web/shared/images/constants.ts`; `web/lib/images/processor.ts`
 * imports it directly.
 */
export const R2_PUBLIC_HOST = "images.coffeemode.app";

/** Absolute public CDN URL for an R2 object key (leading slash tolerated). */
export function r2PublicUrl(key: string): string {
  const clean = key.startsWith("/") ? key.slice(1) : key;
  return `https://${R2_PUBLIC_HOST}/${clean}`;
}

/**
 * Build-time drift guard, called from `next.config.ts`: when
 * `NEXT_PUBLIC_R2_PUBLIC_URL` is set, its host must equal `R2_PUBLIC_HOST`.
 */
export function assertR2PublicUrlMatches(raw: string | undefined): void {
  if (!raw) return;
  let host: string;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_R2_PUBLIC_URL: ${JSON.stringify(raw)}`);
  }
  if (host !== R2_PUBLIC_HOST) {
    throw new Error(
      `NEXT_PUBLIC_R2_PUBLIC_URL host "${host}" does not match R2_PUBLIC_HOST ` +
        `"${R2_PUBLIC_HOST}" (web/lib/images/constants.ts). The constant is the ` +
        `single source — update it there; the service-worker bundle cannot read env.`,
    );
  }
}
