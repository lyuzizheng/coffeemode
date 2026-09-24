import "server-only";

import type { CheckInScores, MaxStay } from "@/types/checkins";
import type { CafeVisibility } from "@/types/cafes";
import type { StoredImage } from "@/types/images";

export interface UserProfileDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  currentCity: string;
  /** Display-only runtime-city name (BRAWUKA-696): client reverse-geocoded
   * locality for rt-* cities; null for launch cities (findCity supplies the
   * name) and un-geocoded runtime cities (country fallback applies). Never
   * feeds scope or identity. */
  currentCityName: string | null;
  lastLocation: { lat: number; lng: number } | null;
  /** Welcome card dismissed — authoritative across devices (DG122). */
  onboarded: boolean;
  createdAt: string;
  /** Opt-in public author identity (spec 0006); false = anonymous default. */
  showPublicIdentity: boolean;
  /** Reserved public handle; null until first opt-in generates one. */
  publicHandle: string | null;
  identityConsentedAt: string | null;
  publicHandleChangedAt: string | null;
}

export interface UserProfileStatsDto {
  cafesCount: number;
  checkinsCount: number;
}

export interface UserCheckInItemDto {
  id: string;
  cafe_id: string;
  cafe_name: string;
  cafe_city: string;
  cafe_is_deleted: boolean;
  visited_at: string;
  scores: CheckInScores;
  max_stay: MaxStay | null;
  likes_count: number;
  notes: string | null;
  photos: StoredImage[];
  is_creation: boolean;
}

export interface UserCafeItemDto {
  id: string;
  name: string;
  city: string;
  cover: string | null;
  last_visited_at: string;
  checkins_count: number;
  is_creation: boolean;
  /** DG147: private rows only ever reach the owner — drives the 仅你可见 badge. */
  visibility: CafeVisibility;
}
