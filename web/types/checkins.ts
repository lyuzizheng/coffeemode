import type { PublicAuthor } from "./identity";
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
  /**
   * Whether this check-in belongs to the viewer (DG72 feed-card edit entry).
   * Server-computed boolean only — the DTO never carries `user_id`, so other
   * viewers learn nothing about who wrote the row (DG13 anonymity holds).
   */
  owned_by_viewer: boolean;
  visited_at: string;
  /**
   * Consented public author (spec 0006). Null means the client renders the
   * existing "a_nomad" copy — default anonymous, revoked, or missing profile.
   */
  author: PublicAuthor | null;
}

export type CheckInFeedMode = "newest" | "helpful";

export interface CheckInFeedPage {
  checkins: PublicCheckIn[];
  /** Opaque mode-bound cursor for the next page; null when exhausted. */
  nextCursor: string | null;
}
