import "server-only";

import type { CheckInScores, MaxStay } from "@/types/checkins";
import type { StoredImage } from "@/types/images";

export interface UserProfileDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  currentCity: string;
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
  cafeId: string;
  cafeName: string;
  cafeCity: string;
  cafeIsDeleted: boolean;
  visitedAt: string;
  scores: CheckInScores;
  maxStay: MaxStay | null;
  likesCount: number;
  notes: string | null;
  photos: StoredImage[];
  isCreation: boolean;
}

export interface UserCafeItemDto {
  id: string;
  name: string;
  city: string;
  cover: string | null;
  lastVisitedAt: string;
  checkinsCount: number;
  isCreation: boolean;
}
