/**
 * Google Places API (New) client — field masks keep billing minimal.
 * The API key lives ONLY in this worker (env), never in Next.js.
 */

import type { Env, POI } from "./types";

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

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
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
    throw new GoogleApiError(`Places details ${res.status}: ${await res.text().catch(() => "")}`, res.status);
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
    const radiusMeters = (opts.radiusKm ?? 50) * 1000;
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
    throw new GoogleApiError(`Places search ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  }
  const data = (await res.json()) as { places?: GooglePlace[] };
  return data.places ?? [];
}

/** Map a Google place to the normalized POI shape. */
export function toPOI(gp: GooglePlace, source: "google" | "apple" = "google"): POI {
  return {
    place_id: gp.id,
    source,
    name: gp.displayName?.text ?? "Unknown",
    lat: gp.location?.latitude ?? 0,
    lng: gp.location?.longitude ?? 0,
    address: gp.formattedAddress ?? null,
    types: gp.types ?? [],
    business_status: gp.businessStatus ?? null,
    hours_json: gp.regularOpeningHours ? JSON.stringify(gp.regularOpeningHours) : null,
    photo_refs: (gp.photos ?? []).map((p) => p.name),
    fetched_at: new Date().toISOString(),
  };
}