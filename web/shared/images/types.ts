/**
 * Image wire contract — the single owner of the request/response DTOs shared
 * by the image-service Worker (`image-service/src/`) and the web transport
 * (`web/lib/images/`), BRAWUKA-738.
 *
 * What stays elsewhere: object-key layout and staging semantics in ./keys.ts;
 * upload limits and size rules in ./constants.ts and ./validation.ts; database
 * rows (`StoredImage`) and their public projection in `web/types/images.ts`;
 * Cloudflare bindings (`Env`) in the Worker.
 */

/**
 * Where an image is attached — the wire `targetType` and the DB row's
 * `source.type` are the same vocabulary.
 */
export type ImageTargetType = "cafe" | "checkin";

/**
 * Stage marker for pre-target processing (issue #86/#158): the creation flow
 * completes uploads before the cafe/check-in exists. The worker stamps
 * targetType="provision" + targetId=<imageUuid>; the attach flow re-PUTs
 * with the real target later.
 */
export type CompleteStageType = ImageTargetType | "provision";

/** A signed URL plus the headers its holder must send with it. */
export interface PresignedUrl {
  url: string;
  headers: Record<string, string>;
}

/** `POST /v1/images/upload` response. */
export interface UploadResponse {
  imageUuid: string;
  /** Presigned PUT for the STAGING key only (`staging/{uuid}.webp`, BRAWUKA-730):
   *  the browser capability never names a published key. */
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  /** Public URL of the published original — the address this upload occupies
   *  once processed. The staged object itself is never public. */
  publicUrl: string;
  expiresAt: string;
  maxUploadBytes: number;
  /** Declared upload size (bytes). Required by /upload since 2026-08-09;
   *  signed into the presigned PUT as Content-Length. */
  size: number;
}

/**
 * `POST /v1/images/complete` request — the VALIDATED shape. Raw wire JSON is
 * untrusted and is parsed into this by the Worker before any use; the web
 * transport builds it from typed values.
 */
export interface CompleteRequest {
  imageUuid: string;
  targetType: CompleteStageType;
  targetId: string;
  userId?: string;
}

/** `POST /v1/images/complete` response. */
export interface CompleteResponse {
  imageUuid: string;
  /** Presigned GET for the stage's source bytes (BRAWUKA-730): the browser's
   *  staged upload on a `provision` complete, the published original on the
   *  attach leg. */
  original: PresignedUrl;
  /** Presigned PUT for the PUBLISHED original — server-written only; the
   *  browser capability never names this key. */
  originalPut: PresignedUrl;
  card: PresignedUrl;
  thumbnail: PresignedUrl;
  publicUrls: {
    original: string;
    card: string;
    thumbnail: string;
  };
  keys: {
    original: string;
    card: string;
    thumbnail: string;
  };
}

/** `POST /v1/images/delete` request. */
export interface DeleteRequest {
  imageUuid: string;
  userId?: string;
  /**
   * Keep the source objects (`staging/` and `original/`) and delete only the
   * derived variants (`card/`, `thumbnail/`). Used when the caller preserves
   * the single-use intent for a retry: the retry re-runs `getProcessUrls`,
   * which reads the staged upload (and re-PUTs the published original), and
   * `processImage` re-PUTs the derived variants anyway.
   */
  keepOriginal?: boolean;
}

/** `POST /v1/images/delete` response. */
export interface DeleteResponse {
  imageUuid: string;
  deleted: string[];
  missing: string[];
}
