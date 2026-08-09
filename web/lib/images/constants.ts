/**
 * Public CDN host for processed image variants.
 *
 * The image-service Worker uploads `original`, `card`, and `thumbnail` WebP
 * variants to R2; this host is served through Cloudflare and cached as
 * immutable by both the CDN and the service worker.
 *
 * This module must stay free of imports (even relative ones): `next.config.ts`
 * imports it, and Next's config transpiler cannot resolve TypeScript modules
 * outside the file itself. The shared upload cap lives in
 * `web/shared/images/constants.ts`; `web/lib/images/processor.ts`
 * imports it directly.
 */
export const R2_PUBLIC_HOST = "images.coffeemode.app";
