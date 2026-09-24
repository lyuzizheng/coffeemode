/**
 * Google Places API (New) client — field masks keep billing minimal.
 * The API key lives ONLY in this worker (env), never in Next.js.
 */

import { DEFAULT_SEARCH_RADIUS_KM } from "../constants";
import { computeExpiresAt } from "../store";
import type { Env, POI, PlacePrediction } from "../types";
import { UpstreamApiError, type SearchBias, type UpstreamPlacesProvider } from "./types";

export const GOOGLE_API_BASE = "https://places.googleapis.com";

/** Field mask for Place Details (New). Billing stays minimal; googleMapsUri
 *  is retained for a future external maps link. */
export const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "businessStatus",
  "regularOpeningHours",
  "googleMapsUri",
].join(",");

/**
 * Field mask for Autocomplete (New). Autocomplete is billed per request
 * (Essentials) regardless of the mask, so this list is about payload size,
 * not SKU tier — but it stays minimal for the same reason.
 *
 * `distanceMeters` is only returned when the request carries an `origin`;
 * it is what lets the discovery list show a distance without coordinates.
 */
export const AUTOCOMPLETE_FIELDS = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
  "suggestions.placePrediction.types",
  "suggestions.placePrediction.distanceMeters",
].join(",");

export interface GooglePlacePrediction {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
  types?: string[];
  distanceMeters?: number;
}

export interface GoogleAutocompleteSuggestion {
  placePrediction?: GooglePlacePrediction;
}

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: { periods?: unknown[] } | null;
  googleMapsUri?: string;
}

export class GoogleApiError extends UpstreamApiError {
  constructor(
    message: string,
    status: number,
  ) {
    super(message, status);
    this.name = "GoogleApiError";
  }
}

/**
 * DG144 / DG52 — Category allowlist for D1/KV persistence.
 * Google Places category types matching food and cafe venues.
 */
export const GOOGLE_FOOD_CAFE_TYPES: Record<string, true> = {
  cafe: true,
  coffee_shop: true,
  bakery: true,
  restaurant: true,
  food: true,
  bar: true,
  meal_delivery: true,
  meal_takeaway: true,
  tea_house: true,
  bubble_tea_store: true,
  espresso_bar: true,
  pastry_shop: true,
  sandwich_shop: true,
  ice_cream_shop: true,
  dessert_shop: true,
  dessert_restaurant: true,
  diner: true,
  bistro: true,
  fast_food_restaurant: true,
  cafeteria: true,
  food_court: true,
};

export function isGoogleFoodOrCafePOI(types?: string[] | null): boolean {
  if (!types || types.length === 0) return false;
  return types.some((t) => Boolean(GOOGLE_FOOD_CAFE_TYPES[t.toLowerCase()]));
}

/**
 * Last-resort heuristic for never-seen ids: Google place ids are ChIJ… or
 * 0x…:0x…; Apple refs are arbitrary. Only used when neither KV nor D1 knows
 * the id — stored rows' explicit `source` column is authoritative (issue #38).
 */
export function isGooglePlaceId(placeId: string): boolean {
  return /^(ChIJ|0x)/.test(placeId);
}

function baseUrl(env: Env): string {
  return env.GOOGLE_PLACES_BASE_URL ?? GOOGLE_API_BASE;
}

function headers(env: Env, fieldMask = DETAIL_FIELDS): HeadersInit {
  return {
    "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
    "X-Goog-FieldMask": fieldMask,
    "Content-Type": "application/json",
  };
}

/**
 * GET /v1/places/:id — one POI, enriched.
 *
 * `sessionToken` terminates the Autocomplete (New) session that produced the
 * id: with it, every Autocomplete request in that session is billed at
 * `Autocomplete Session Usage` ($0); without it they fall back to per-request
 * pricing. A stale/unknown token is not an error — Google bills the call as a
 * plain Place Details request.
 */
export async function fetchPlaceDetails(
  placeId: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  sessionToken?: string,
): Promise<GooglePlace> {
  const params = new URLSearchParams();
  if (sessionToken) params.set("sessionToken", sessionToken);
  const query = params.toString();
  const url = `${baseUrl(env)}/v1/places/${encodeURIComponent(placeId)}${query ? `?${query}` : ""}`;
  const res = await fetchImpl(url, { headers: headers(env, DETAIL_FIELDS) });
  if (!res.ok) {
    await res.text().catch(() => undefined); // drain; upstream bodies are never relayed
    throw new GoogleApiError(`Places details failed with upstream status ${res.status}`, res.status);
  }
  return (await res.json()) as GooglePlace;
}

/**
 * Autocomplete (New) caps `locationBias.circle.radius` at 50,000 m — a larger
 * value is an upstream 400 (BRAWUKA-439). The worker's own ceiling
 * (`MAX_SEARCH_RADIUS_KM`, 200 km) is a bounding-box guard, not Google's, so
 * the bias radius is clamped here instead of rejected: `locationBias` only
 * steers ranking, never filters, so shrinking it cannot hide a result the
 * caller could legitimately see.
 */
const AUTOCOMPLETE_MAX_BIAS_RADIUS_M = 50_000;

/**
 * POST /v1/places:autocomplete — the typing phase.
 *
 * `sessionToken` is REQUIRED by this module: an Autocomplete request without
 * one is billed per request, which is exactly the cost this path exists to
 * avoid. The caller (handler) rejects requests that carry no session.
 * Requests that share a token bill at $0 once a Place Details call with that
 * token terminates the session; an unterminated session bills per request.
 *
 * `origin` is what makes Google return `distanceMeters`; `locationBias`
 * separately steers ranking. Both are sent when the caller knows where the
 * user is.
 */
export async function autocomplete(
  query: string,
  opts: { lat?: number; lng?: number; radiusKm?: number; sessionToken: string },
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleAutocompleteSuggestion[]> {
  const body: Record<string, unknown> = {
    input: query,
    sessionToken: opts.sessionToken,
  };
  if (opts.lat !== undefined && opts.lng !== undefined) {
    const center = { latitude: opts.lat, longitude: opts.lng };
    body.origin = center;
    body.locationBias = {
      circle: {
        center,
        radius: Math.min(
          (opts.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM) * 1000,
          AUTOCOMPLETE_MAX_BIAS_RADIUS_M,
        ),
      },
    };
  }
  const res = await fetchImpl(`${baseUrl(env)}/v1/places:autocomplete`, {
    method: "POST",
    headers: headers(env, AUTOCOMPLETE_FIELDS),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await res.text().catch(() => undefined); // drain; upstream bodies are never relayed
    throw new GoogleApiError(`Places autocomplete failed with upstream status ${res.status}`, res.status);
  }
  const data = (await res.json()) as { suggestions?: GoogleAutocompleteSuggestion[] };
  return data.suggestions ?? [];
}

/**
 * Map one Autocomplete suggestion to the normalized prediction shape.
 * Returns null for query predictions (no `placePrediction`) and for entries
 * Google returned without an id — neither can be resolved to a place.
 */
export function toPrediction(
  suggestion: GoogleAutocompleteSuggestion,
): PlacePrediction | null {
  const p = suggestion.placePrediction;
  if (!p?.placeId) return null;
  const name = p.structuredFormat?.mainText?.text ?? p.text?.text;
  if (!name) return null;
  return {
    place_id: p.placeId,
    source: "google",
    name,
    address: p.structuredFormat?.secondaryText?.text ?? null,
    types: p.types ?? [],
    ...(p.distanceMeters !== undefined ? { distance_meters: p.distanceMeters } : {}),
  };
}

/** Map a Google place to the normalized POI shape.
 *  Rejects places without a location — storing them at (0,0) would create
 *  phantom POIs at null island. */
export function toPOI(gp: GooglePlace, source: "google" | "apple" = "google"): POI {
  if (!gp.location) {
    throw new Error(`Google place ${gp.id} has no location; refusing to store at (0,0)`);
  }
  const fetched_at = new Date().toISOString();
  return {
    place_id: gp.id,
    source,
    name: gp.displayName?.text ?? "Unknown",
    lat: gp.location.latitude,
    lng: gp.location.longitude,
    address: gp.formattedAddress ?? null,
    types: gp.types ?? [],
    business_status: gp.businessStatus ?? null,
    hours_json: gp.regularOpeningHours ? JSON.stringify(gp.regularOpeningHours) : null,
    fetched_at,
    expires_at: computeExpiresAt(fetched_at),
  };
}

/** Upstream places provider implementation for Google Places API (New). */
export class GooglePlacesProvider implements UpstreamPlacesProvider<GooglePlace> {
  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async autocomplete(
    q: string,
    opts: SearchBias & { sessionToken: string },
  ): Promise<PlacePrediction[]> {
    const suggestions = await autocomplete(
      q,
      {
        lat: opts.lat,
        lng: opts.lng,
        radiusKm: opts.radiusKm,
        sessionToken: opts.sessionToken,
      },
      this.env,
      this.fetchImpl,
    );
    const predictions: PlacePrediction[] = [];
    for (const suggestion of suggestions) {
      const prediction = toPrediction(suggestion);
      if (prediction) predictions.push(prediction);
    }
    return predictions;
  }

  async getDetails(placeId: string, sessionToken?: string): Promise<GooglePlace> {
    return fetchPlaceDetails(placeId, this.env, this.fetchImpl, sessionToken);
  }

  toPOI(raw: GooglePlace): POI {
    return toPOI(raw, "google");
  }

  matchesCategory(types: string[]): boolean {
    return isGoogleFoodOrCafePOI(types);
  }
}
