/**
 * Image upload limits — single source of truth for web/ and
 * image-service/ (issue #26).
 */

/**
 * Hard cap for a single image upload (bytes), enforced at three layers:
 * the web upload route rejects `size` values above it, image-service signs
 * presigned PUTs with a matching Content-Length so R2 refuses oversized
 * bodies, and the web processor aborts downloads past
 * `MAX_ORIGINAL_DOWNLOAD_BYTES` so a rogue object is never buffered.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
