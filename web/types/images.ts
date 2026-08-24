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

/** Public image projection (spec 0001 DG13): author id `by` stripped. */
export type PublicStoredImage = Omit<StoredImage, "by">;

export interface UploadUrlResponse {
  imageUuid: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  publicUrl: string;
  expiresAt: string;
  maxUploadBytes: number;
  size?: number;
}

/**
 * Stage marker for pre-target processing (issue #86/#158): the creation flow
 * completes uploads before the cafe/check-in exists. The worker stamps
 * targetType="provision" + targetId=<imageUuid>; the attach flow re-PUTs
 * with the real target later.
 */
export type CompleteStageType = ImageTargetType | "provision";

export interface CompleteImageRequest {
  imageUuid: string;
  targetType: CompleteStageType;
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
