import type { POI } from "../types";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface UpstreamPlacesProvider<RawPlace = unknown> {
  textSearch(q: string, bias?: { lat?: number; lng?: number; radiusKm?: number }): Promise<RawPlace[]>;
  getDetails(placeId: string): Promise<RawPlace>;
  toPOI(raw: RawPlace): POI;                            // vendor → 规范化
  matchesCategory(types: string[]): boolean;            // vendor 类目 → food/cafe 过滤
  reverseGeocode?(c: Coordinates): Promise<POI | null>; // Reverse geocode to normalized food/cafe POI (Stage 2)
}

export class UpstreamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamApiError";
  }
}
