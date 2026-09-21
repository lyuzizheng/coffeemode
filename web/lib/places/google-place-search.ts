import type { AutocompleteResponse, POI } from "@shared/places/types";
import { apiFetch } from "@/lib/http";
import type { CreateTranslator, PlaceSearchProvider } from "./place-search";

/**
 * Google place search via the server proxy, in two phases (BRAWUKA-602):
 *
 *   typing    → `GET /api/places/autocomplete` (Autocomplete (New), $0 once
 *               the session is terminated)
 *   selection → `GET /api/places/details`      (Place Details (New), billed)
 *
 * Both calls carry the same `sessionToken`, which is what moves the
 * Autocomplete requests into `Autocomplete Session Usage` ($0). The session
 * is opened lazily on the first search and terminated by `resolve` — Google
 * ends a session at the Place Details call, so a new one starts on the next
 * search.
 *
 * Failures propagate as `ApiError` (spec 0011 D9): the caller renders them
 * with `apiErrorMessage` and routes 401s to the sign-in gate.
 */
export function googlePlaceSearch(t: CreateTranslator): PlaceSearchProvider {
  let session: string | null = null;

  const openSession = (): string => {
    session ??= crypto.randomUUID();
    return session;
  };

  return {
    id: "google",
    label: t("google"),
    async search(query, bias) {
      const params = new URLSearchParams({ q: query, session: openSession() });
      if (bias) {
        params.set("lat", String(bias.lat));
        params.set("lng", String(bias.lng));
      }
      const data = await apiFetch<AutocompleteResponse>(`/api/places/autocomplete?${params}`);
      return data.predictions.map((prediction) => ({ prediction }));
    },
    async resolve(candidate) {
      const params = new URLSearchParams({
        place_id: candidate.prediction.place_id,
        session: openSession(),
      });
      const poi = await apiFetch<POI>(`/api/places/details?${params}`);
      // The session is spent: Google terminated it at this Details call.
      session = null;
      return poi;
    },
  };
}
