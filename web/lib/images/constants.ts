/**
 * Public CDN host for processed image variants.
 *
 * The image-service Worker uploads `original`, `card`, and `thumbnail` WebP
 * variants to R2; this host is served through Cloudflare and cached as
 * immutable by both the CDN and the service worker.
 */
export const R2_PUBLIC_HOST = "images.coffeemode.app";

/**
 * Hard cap for a single image upload (bytes).
 *
 * Enforced at three layers: the web upload route rejects `size` values above
 * it, the image-service signs presigned PUTs with a matching Content-Length
 * so R2 itself refuses oversized bodies, and the processor aborts downloads
 * past `MAX_ORIGINAL_DOWNLOAD_BYTES` so a rogue object can never be buffered.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Download guard for the image processor (bytes). Uploads are capped at
 * `MAX_UPLOAD_BYTES`, but the processor must not trust that alone: it streams
 * the R2 original and aborts once this many bytes arrive. The small headroom
 * over the upload cap keeps legitimate uploads from failing on rounding while
 * still bounding memory to ~10 MB per request.
 */
export const MAX_ORIGINAL_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES + 512 * 1024;
