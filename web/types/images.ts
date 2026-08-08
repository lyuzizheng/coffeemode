export type ImageTargetType = "cafe" | "checkin";

/**
 * Source attribution for images stored inside `cafes.gallery` or
 * `checkins.photos`. Lets the gallery query hide photos whose source check-in
 * has been soft-deleted (spec 0001, 0004).
 */
export interface StoredImageSource {
  type: ImageTargetType;
  id: string;
}

export interface StoredImage {
  id: string; // imageUuid
  original: string; // R2 key
  card: string;
  thumbnail: string;
  w: number; // original width
  h: number; // original height
  by: string; // user id
  at: string; // ISO timestamp
  source?: StoredImageSource; // where this image originated (cafe or checkin)
}

export interface UploadUrlResponse {
  imageUuid: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  publicUrl: string;
  expiresAt: string;
}

export interface CompleteImageRequest {
  imageUuid: string;
  targetType: ImageTargetType;
  targetId: string;
  isCover?: boolean;
}

export interface CompleteImageResponse {
  imageUuid: string;
  publicUrls: {
    original: string;
    card: string;
    thumbnail: string;
  };
  width: number;
  height: number;
}
