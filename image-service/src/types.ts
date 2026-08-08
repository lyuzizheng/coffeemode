export interface Env {
  IMAGE_SERVICE_TOKEN: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
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

