/**
 * Google Places API (New) client — field masks keep billing minimal.
 * The API key lives ONLY in this worker (env), never in Next.js.
 */

import { DEFAULT_SEARCH_RADIUS_KM, MAX_REVERSE_GEOCODE_CANDIDATES } from "../constants";
import { computeExpiresAt } from "../store";
import type { Env, POI, PlacePrediction } from "../types";
import { UpstreamApiError, type Coordinates, type SearchBias, type UpstreamPlacesProvider } from "./types";

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

export const GOOGLE_GEOCODE_API_BASE = "https://maps.googleapis.com";


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
      circle: { center, radius: (opts.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM) * 1000 },
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
export interface GoogleGeocodeResult {
  place_id: string;
  formatted_address?: string;
  types?: string[];
}

export interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

/**
 * Reverse geocode coordinates to a normalized food/cafe POI.
 * Calls Google Geocoding API, extracts candidate place_id matching food/cafe
 * or establishment/point_of_interest, enriches via Place Details (New),
 * and verifies food/cafe category per BRAWUKA-328. Non-food POIs and
 * coordinates without establishments return null.
 */
export async function reverseGeocode(
  coordinates: Coordinates,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<POI | null> {
  const { lat, lng } = coordinates;
  const baseUrl = env.GOOGLE_GEOCODE_BASE_URL ?? env.GOOGLE_PLACES_BASE_URL ?? GOOGLE_GEOCODE_API_BASE;
  const url = `${baseUrl}/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(env.GOOGLE_PLACES_API_KEY)}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    // P0 scrub: upstream bodies are never relayed (drained only, so the
    // socket can be reused) and the thrown message carries the HTTP status
    // only — never body text, never the request URL (it embeds `key=`).
    await res.text().catch(() => undefined);
    throw new GoogleApiError(`Geocoding failed with upstream status ${res.status}`, res.status);
  }

  const data = (await res.json()) as GoogleGeocodeResponse;

  if (data.status === "ZERO_RESULTS") {
    return null;
  }

  if (data.status && data.status !== "OK") {
    if (data.status === "OVER_QUERY_LIMIT") {
      throw new GoogleApiError("Geocoding quota exceeded", 429);
    }
    if (data.status === "REQUEST_DENIED") {
      // P0 scrub: the upstream `error_message` can echo the key back (Google
      // does this on auth failures) — never relay it, throw canned text.
      throw new GoogleApiError("Geocoding request denied", 403);
    }
    if (data.status === "INVALID_REQUEST") {
      return null;
    }
    // P0 scrub: the upstream `error_message` can echo the key — never relay
    // it, throw canned text with the upstream status label only.
    throw new GoogleApiError(`Geocoding upstream status ${data.status}`, 502);
  }

  const results = data.results ?? [];
  if (results.length === 0) {
    return null;
  }

  // Bounded candidate selection (BRAWUKA-332):
  // 1. First preference: results whose geocoding types match food/cafe directly
  // 2. Second preference: results representing establishment or point_of_interest
  // Capped at MAX_REVERSE_GEOCODE_CANDIDATES to limit billed Place Details calls.
  const candidates: GoogleGeocodeResult[] = [];
  const seenPlaceIds = new Set<string>();

  for (const r of results) {
    if (r.place_id && !seenPlaceIds.has(r.place_id) && isGoogleFoodOrCafePOI(r.types)) {
      seenPlaceIds.add(r.place_id);
      candidates.push(r);
      if (candidates.length >= MAX_REVERSE_GEOCODE_CANDIDATES) break;
    }
  }

  if (candidates.length < MAX_REVERSE_GEOCODE_CANDIDATES) {
    for (const r of results) {
      if (
        r.place_id &&
        !seenPlaceIds.has(r.place_id) &&
        r.types?.some((t) => t === "point_of_interest" || t === "establishment")
      ) {
        seenPlaceIds.add(r.place_id);
        candidates.push(r);
        if (candidates.length >= MAX_REVERSE_GEOCODE_CANDIDATES) break;
      }
    }
  }

  for (const candidate of candidates) {
    let raw: GooglePlace;
    try {
      raw = await fetchPlaceDetails(candidate.place_id, env, fetchImpl);
    } catch (e) {
      if (e instanceof UpstreamApiError && e.status === 404) {
        continue;
      }
      throw e;
    }

    let poi: POI;
    try {
      poi = toPOI(raw, "google");
    } catch {
      continue;
    }

    if (isGoogleFoodOrCafePOI(poi.types)) {
      return poi;
    }
  }

  return null;
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

  async reverseGeocode(c: Coordinates): Promise<POI | null> {
    return reverseGeocode(c, this.env, this.fetchImpl);
  }
}
