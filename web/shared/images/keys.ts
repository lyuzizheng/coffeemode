/**
 * Image object-key layout — single source of truth for web/ and
 * image-service/ (BRAWUKA-730).
 *
 * Why the staging prefix exists: `POST /v1/images/upload` hands the browser a
 * presigned PUT whose signature is valid for the URL TTL. While that
 * capability signed the published original's own key, a repeated PUT after
 * publication replaced the processed bytes — dropping the completion
 * metadata (`targetType`/`targetId`) and the immutable cache header — while
 * the DB row, its recorded dimensions, and the derivatives still described
 * the processed image. A browser capability therefore only ever targets
 * `staging/`:
 *
 *   staging/{uuid}.webp    browser-writable raw upload. Never published,
 *                          never referenced by a DB row; the orphan sweeper
 *                          deletes it by age alone.
 *   original/{uuid}.webp   published original. Written only through URLs
 *                          issued by `POST /v1/images/complete`: the
 *                          server-side sharp processor, then the attach-leg
 *                          re-stamp.
 *   card/{uuid}.webp       published derivatives, written from the same
 *   thumbnail/{uuid}.webp  complete()-issued URLs.
 */

export interface ImageKeys {
  /** Browser-writable staged upload; never a published key. */
  staging: string;
  /** Published original (the key a DB `StoredImage` references). */
  original: string;
  card: string;
  thumbnail: string;
}

export function imageKeys(imageUuid: string): ImageKeys {
  return {
    staging: `staging/${imageUuid}.webp`,
    original: `original/${imageUuid}.webp`,
    card: `card/${imageUuid}.webp`,
    thumbnail: `thumbnail/${imageUuid}.webp`,
  };
}
