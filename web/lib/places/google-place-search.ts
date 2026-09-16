import type { POISearchResponse } from "@shared/places/types";
import { throwIfUnauthorized, responseMessage } from "@/lib/http";
import type { CreateTranslator, PlaceSearchProvider } from "./place-search";

/**
 * Google place search via the server proxy (`GET /api/places/search?source=
 * google` → poi-service → Google Places). Results are already server-side —
 * no persistOnSelect.
 */
export function googlePlaceSearch(t: CreateTranslator): PlaceSearchProvider {
  return {
    id: "google",
    label: t("google"),
    async search(query, bias) {
      const params = new URLSearchParams({ source: "google", q: query });
      if (bias) {
        params.set("lat", String(bias.lat));
        params.set("lng", String(bias.lng));
      }
      const response = await fetch(`/api/places/search?${params}`);
      throwIfUnauthorized(response);
      if (!response.ok) throw new Error(await responseMessage(response, t("searchFailed")));
      const data = (await response.json()) as POISearchResponse;
      return data.results;
    },
  };
}
