/**
 * Public CDN host for processed image variants.
 *
 * The image-service Worker uploads `original`, `card`, and `thumbnail` WebP
 * variants to R2; this host is served through Cloudflare and cached as
 * immutable by both the CDN and the service worker.
 */
export const R2_PUBLIC_HOST = "images.coffeemode.app";
