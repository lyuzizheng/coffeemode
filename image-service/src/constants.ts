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
 * Lifecycle (issue #158): R2 lifecycle rules cannot inspect custom metadata
 * (targetType / targetId), so a blanket age rule on `original/` is UNSAFE —
 * completed gallery originals live under the same prefix. complete() REQUIRES
 * stage metadata on every call: targetType="provision" + targetId=<imageUuid>
 * for the pre-target creation flow (issue #86), or "cafe"/"checkin" + the real
 * id for attached originals. The safe cleanup is
 * `scripts/clean-orphan-originals.mjs` (npm run clean:orphan-originals): it
 * lists `original/` objects older than RETENTION_DAYS and deletes only those
 * WITHOUT a marker or still in the "provision" stage (never attached). Live
 * cafe/checkin originals are never matched. DRY_RUN=1 default;
 * cursor-paginated and batch-bounded; idempotent. #154 schedules it in
 * production with least-privilege R2 credentials (#147).
 */
import { MAX_UPLOAD_BYTES } from "../../web/shared/images/constants";

export { MAX_UPLOAD_BYTES };

/** Cache-Control for immutable WebP variants served through Cloudflare. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Stage marker for pre-target processing (issue #86 creation flow): complete()
 * is called before the cafe/check-in exists, so the original is stamped
 * targetType="provision" + targetId=<imageUuid>. The attach flow re-PUTs with
 * the real target later. The #158 cleanup treats provision-stage objects past
 * retention as abandoned (an upload that never attached).
 */
export const PROVISION_TARGET_TYPE = "provision";

/** Default TTL (seconds) for presigned upload/download URLs. The
 *  UPLOAD_URL_TTL_SECONDS wrangler var overrides this when set. */
export const DEFAULT_UPLOAD_URL_TTL_SECONDS = 600;

/** Maximum length of a sanitized custom-metadata value. */
export const METADATA_MAX_LENGTH = 64;
