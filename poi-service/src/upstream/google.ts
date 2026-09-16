/**
 * Google Places API (New) client — field masks keep billing minimal.
 * The API key lives ONLY in this worker (env), never in Next.js.
 */

import { DEFAULT_SEARCH_RADIUS_KM } from "../constants";
import type { Env, POI } from "../types";
import { UpstreamApiError, type UpstreamPlacesProvider } from "./types";

export const GOOGLE_API_BASE = "https://places.googleapis.com";

/** Field mask for Place Details (New). Photos are billed as embedded content,
 *  so we only keep the photo reference (name) and fetch lazily. */
export const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "businessStatus",
  "regularOpeningHours",
  "photos",
  "googleMapsUri",
].join(",");

/** Field mask for Text Search (New). The response is an array under the
 *  top-level `places` field, so every selected field must be prefixed. */
export const SEARCH_FIELDS = DETAIL_FIELDS.split(",").map((f) => `places.${f}`).join(",");

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: { periods?: unknown[] } | null;
  photos?: Array<{ name: string }>;
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

/** GET /v1/places/:id — one POI, enriched. */
export async function fetchPlaceDetails(
  placeId: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<GooglePlace> {
  const url = `${baseUrl(env)}/v1/places/${encodeURIComponent(placeId)}`;
  const res = await fetchImpl(url, { headers: headers(env, DETAIL_FIELDS) });
  if (!res.ok) {
    await res.text().catch(() => undefined); // drain; upstream bodies are never relayed
    throw new GoogleApiError(`Places details failed with upstream status ${res.status}`, res.status);
  }
  return (await res.json()) as GooglePlace;
}

/** POST /v1/places:searchText — text search with optional location bias. */
export async function textSearch(
  query: string,
  opts: { lat?: number; lng?: number; radiusKm?: number },
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<GooglePlace[]> {
  const body: Record<string, unknown> = { textQuery: query };
  if (opts.lat !== undefined && opts.lng !== undefined) {
    const radiusMeters = (opts.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM) * 1000;
    body.locationBias = {
      circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: radiusMeters },
    };
  }
  const res = await fetchImpl(`${baseUrl(env)}/v1/places:searchText`, {
    method: "POST",
    headers: headers(env, SEARCH_FIELDS),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await res.text().catch(() => undefined); // drain; upstream bodies are never relayed
    throw new GoogleApiError(`Places search failed with upstream status ${res.status}`, res.status);
  }
  const data = (await res.json()) as { places?: GooglePlace[] };
  return data.places ?? [];
}

/** Map a Google place to the normalized POI shape.
 *  Rejects places without a location — storing them at (0,0) would create
 *  phantom POIs at null island. */
export function toPOI(gp: GooglePlace, source: "google" | "apple" = "google"): POI {
  if (!gp.location) {
    throw new Error(`Google place ${gp.id} has no location; refusing to store at (0,0)`);
  }
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
    photo_refs: (gp.photos ?? []).map((p) => p.name),
    fetched_at: new Date().toISOString(),
  };
}

/** Upstream places provider implementation for Google Places API (New). */
export class GooglePlacesProvider implements UpstreamPlacesProvider<GooglePlace> {
  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async textSearch(
    q: string,
    bias?: { lat?: number; lng?: number; radiusKm?: number },
  ): Promise<GooglePlace[]> {
    return textSearch(q, bias ?? {}, this.env, this.fetchImpl);
  }

  async getDetails(placeId: string): Promise<GooglePlace> {
    return fetchPlaceDetails(placeId, this.env, this.fetchImpl);
  }

  toPOI(raw: GooglePlace): POI {
    return toPOI(raw, "google");
  }

  matchesCategory(types: string[]): boolean {
    return isGoogleFoodOrCafePOI(types);
  }
}
