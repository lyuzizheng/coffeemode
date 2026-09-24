import { haversineKm } from "@shared/places/geo";
import type { POI } from "@shared/places/types";

/**
 * Bind a cafe creation's provider reference to its submitted content
 * (BRAWUKA-666): `POST /api/cafes` verifies a `google_place_id` /
 * `apple_poi_id` against the POI service (BRAWUKA-636, existence only), so
 * this proximity check binds the verified POI to the submitted coordinates.
 * A real place_id paired with far-away coords (cross-city squat / poisoned
 * nearby entry) is rejected instead of occupying the first-writer-wins
 * dedupe slot. Legit pin nudges within the threshold pass untouched —
 * strict coordinate equality is deliberately not required.
 */

export interface PlaceProximityInput {
  lat: number;
  lng: number;
  poi: POI;
}

/** Result carries the measured distance so callers can log the rejection. */
export type PlaceProximityResult = { ok: true; distanceKm: number } | { ok: false; distanceKm: number };

export function checkPlaceProximity(input: PlaceProximityInput, maxKm: number): PlaceProximityResult {
  const distanceKm = haversineKm(input.lat, input.lng, input.poi.lat, input.poi.lng);
  return distanceKm <= maxKm ? { ok: true, distanceKm } : { ok: false, distanceKm };
}
