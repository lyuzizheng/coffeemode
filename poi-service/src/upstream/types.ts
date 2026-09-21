import type { POI, PlacePrediction } from "../types";

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Location hint for a search: the user's known center and how far out to look. */
export interface SearchBias {
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface UpstreamPlacesProvider<RawPlace = unknown> {
  /**
   * Typing-phase suggestions. Free for Google when the returned ids are later
   * resolved through `getDetails` with the same session token.
   */
  autocomplete(q: string, opts: SearchBias & { sessionToken: string }): Promise<PlacePrediction[]>;
  /**
   * Full place record — the billed call. `sessionToken` terminates the
   * Autocomplete session that produced the id (see `fetchPlaceDetails`).
   */
  getDetails(placeId: string, sessionToken?: string): Promise<RawPlace>;
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
