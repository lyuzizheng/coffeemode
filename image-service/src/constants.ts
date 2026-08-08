/**
 * Image upload constraints and lifecycle guidance.
 *
 * The 10 MB cap applies to the original WebP uploaded by the browser.
 * Clients should send the file size in the upload request body so the
 * presigned PUT URL can include a matching Content-Length header and R2
 * can enforce the cap at the edge.
 *
 * Lifecycle: R2 lifecycle rules can delete abandoned `original/` objects
 * older than 7 days. Because R2 lifecycle rules cannot inspect custom
 * metadata (targetType / targetId), the recommended setup is:
 *   1. A lifecycle rule that deletes all `original/` objects after 7 days, OR
 *   2. A scheduled cleanup Worker/script that lists `original/` objects,
 *      keeps objects whose `targetType` metadata is set, and deletes the rest
 *      after 7 days. The cleanup Worker should use the same R2 credentials.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Cache-Control for immutable WebP variants served through Cloudflare. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
