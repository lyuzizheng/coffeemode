import type { PublicStoredImage, StoredImage } from "./images";

/** Check-in slider dimensions, all 0-100. Only scored keys are sent/stored. */
export interface CheckInScores {
  wifi?: number;
  outlets?: number;
  seats?: number;
  temp?: number;
  coffee?: number;
  overall?: number;
}

export const MAX_STAY_VALUES = [
  "unlimited",
  "3h",
  "2h",
  "1h",
  "peak",
  "unknown",
] as const;

export type MaxStay = (typeof MAX_STAY_VALUES)[number];

/** Policy answers recorded on a check-in. `unknown` is an explicit answer. */
export interface CheckInPolicy {
  max_stay?: MaxStay;
}

/** A row in the `checkins` table (every review is a check-in). */
export interface CheckIn {
  id: string;
  cafe_id: string;
  user_id: string;
  is_creation: boolean;
  scores: CheckInScores;
  max_stay: MaxStay | null;
  note: string | null;
  photos: StoredImage[];
  likes_count: number;
  visited_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}



/**
 * Public feed DTO (discovery-sheet): unauthenticated-safe — `user_id` and
 * `StoredImage.by` are omitted, the author renders as "A nomad" at MVP.
 */
export interface PublicCheckIn {
  id: string;
  scores: CheckInScores;
  max_stay: MaxStay | null;
  note: string | null;
  photos: PublicStoredImage[];
  likes_count: number;
  /** Whether the (possibly anonymous) viewer liked this check-in. */
  liked_by_viewer: boolean;
  visited_at: string;
}

export type CheckInFeedMode = "newest" | "helpful";

export interface CheckInFeedPage {
  checkins: PublicCheckIn[];
  /** Opaque mode-bound cursor for the next page; null when exhausted. */
  nextCursor: string | null;
}

/** Payload used to create or edit a check-in. */
export interface CheckInInput extends CheckInPolicy {
  cafe_id?: string; // required for create; omitted on edit
  scores: CheckInScores;
  note?: string;
  photos?: StoredImage[];
  visited_at?: string;
  is_creation?: boolean;
}

/** A like on a check-in. Source of truth for `checkins.likes_count`. */
export interface CheckInLike {
  id: string;
  user_id: string;
  checkin_id: string;
  created_at: string;
}
