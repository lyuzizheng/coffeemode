/**
 * Image upload constraints and lifecycle guidance.
 *
 * The 10 MB cap applies to the original WebP uploaded by the browser and is
 * ENFORCED server-side (it must hold, not merely "should"):
 *   - POST /v1/images/upload REQUIRES `size` and rejects values over the cap;
 *     the presigned PUT URL is signed with that Content-Length so R2 rejects
 *     mismatched bodies at the edge.
 *   - POST /v1/images/complete verifies the ACTUAL R2 object size via head()
 *     and refuses to issue process URLs when it exceeds the cap (422).
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

/** Default TTL (seconds) for presigned upload/download URLs. The
 *  UPLOAD_URL_TTL_SECONDS wrangler var overrides this when set. */
export const DEFAULT_UPLOAD_URL_TTL_SECONDS = 600;

/** Maximum length of a sanitized custom-metadata value. */
export const METADATA_MAX_LENGTH = 64;
