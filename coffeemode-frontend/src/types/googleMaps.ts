import { Cafe } from "./cafe";

// DTOs for Google Maps resolve endpoint
export interface ResolvePlaceRequestDto {
  title?: string;
  description?: string;
  url?: string;
}

export interface ResolvePlaceResponseDto {
  placeId: string;
  skippedDetails: boolean;
  cafe: Cafe;
}