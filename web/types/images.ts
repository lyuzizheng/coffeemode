import type { ImageTargetType } from "@shared/images/types";

/**
 * Source attribution for images stored inside `cafes.gallery` or
 * `checkins.photos`. Lets the gallery query hide photos whose source check-in
 * has been soft-deleted (spec 0001, 0004).
 */
interface StoredImageSource {
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
