import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@/lib/places/constants";
import { POIServiceError, searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";

function parseQueryNumber(value: string | null): number {
  return value === null || value.trim() === "" ? NaN : Number(value);
}

/**
 * GET /api/places/search?q&lat&lng&r
 * Proxy to the POI cache service search. `source=google` selects live Google
 * Places search; the default searches the reusable stored-POI cache. Apple
 * MapKit search runs in the browser and stores its selected result through
 * POST /api/places/external.
 *
 * The radius parameter is clamped to MAX_SEARCH_RADIUS_KM to prevent abuse.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const source = searchParams.get("source") ?? "stored";
  const lat = parseQueryNumber(searchParams.get("lat"));
  const lng = parseQueryNumber(searchParams.get("lng"));
  const rRaw = searchParams.get("r");
  const r = rRaw ? parseQueryNumber(rRaw) : DEFAULT_SEARCH_RADIUS_KM;

  const latProvided = searchParams.has("lat");
  const lngProvided = searchParams.has("lng");
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
  if ((latProvided || lngProvided) && !hasCoords) {
    return apiError("invalid_request", "lat/lng must both be numbers", 400);
  }
  if (hasCoords && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
    return apiError("invalid_request", "lat must be [-90, 90] and lng [-180, 180]", 400);
  }
  if (q === "" && !hasCoords) {
    return apiError("invalid_request", "q or lat+lng required", 400);
  }
  if (Number.isNaN(r) || r <= 0) {
    return apiError("invalid_request", "r must be a positive number (km)", 400);
  }
  if (source !== "stored" && source !== "google") {
    return apiError("invalid_request", "source must be stored or google", 400);
  }
  if (source === "google" && q === "") {
    return apiError("invalid_request", "q is required for Google search", 400);
  }

  const clampedR = Math.min(r, MAX_SEARCH_RADIUS_KM);

  const user = await getCurrentUser();
  // Live Google search bills per request; only the signed-in creation flow may
  // trigger it. Stored-cache search stays public for the discovery surface.
  if (source === "google" && !user) {
    return apiError("unauthorized", 401);
  }
  const clientId = getClientIdentifier(request, user);
  const limit = await checkRateLimit(
    "places",
    clientId,
    rateLimitBuckets("places"),
    "GET /api/places/search",
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  try {
    const data =
      source === "google"
        ? await searchExternalPOIs({
            q,
            lat: hasCoords ? lat : undefined,
            lng: hasCoords ? lng : undefined,
            r: clampedR,
          })
        : await searchPOIs({
            q: q || undefined,
            lat: hasCoords ? lat : undefined,
            lng: hasCoords ? lng : undefined,
            r: clampedR,
          });

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return apiError("poi_service", err.message, err.status);
    }
    console.error("/api/places/search failed", err);
    return apiError("upstream_error", 502);
  }
}
