import type { POISearchResponse } from "@shared/places/types";
import { apiFetch } from "@/lib/http";
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
      const data = await apiFetch<POISearchResponse>(`/api/places/search?${params}`);
      return data.results;
    },
  };
}
