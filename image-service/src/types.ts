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
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
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

