"use client";

import { apiFetch } from "@/lib/http";
import type { POI, PlacePrediction } from "@shared/places/types";

/**
 * Resolve one Autocomplete prediction into a full POI (BRAWUKA-602).
 *
 * This is the billed half of the two-phase search, so it runs only on an
 * explicit selection — never while typing. `session` must be the token the
 * prediction was produced under: it terminates the Autocomplete session,
 * which is what moves the typing phase to `Autocomplete Session Usage` ($0).
 *
 * Failures propagate as `ApiError` (spec 0011 D9): the caller renders them
 * with `apiErrorMessage` and routes 401s to the sign-in gate.
 */
export async function resolvePrediction(
  prediction: PlacePrediction,
  session: string | undefined,
): Promise<POI> {
  const params = new URLSearchParams({ place_id: prediction.place_id });
  if (session) params.set("session", session);
  return await apiFetch<POI>(`/api/places/details?${params}`);
}
