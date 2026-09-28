export interface Env {
  IMAGE_SERVICE_TOKEN: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  /**
   * Optional S3-compatible endpoint override for local dev (e.g. MinIO at
   * http://localhost:9000). When unset, the R2 endpoint is derived from
   * R2_ACCOUNT_ID as before.
   */
  R2_ENDPOINT?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  R2_BUCKET: R2Bucket;
}

export interface PresignedUrl {
  url: string;
  headers: Record<string, string>;
}

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

export interface CompleteRequest {
  imageUuid: string;
  userId?: string;
  targetType?: string;
  targetId?: string;
}


export interface CompleteResponse {
  imageUuid: string;
  original: PresignedUrl;      // presigned GET for the original
  originalPut: PresignedUrl;  // presigned PUT to overwrite original after capping
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

export interface DeleteResponse {
  imageUuid: string;
  deleted: string[];
  missing: string[];
}


