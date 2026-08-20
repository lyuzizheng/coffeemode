import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@/lib/places/constants";
import { POIServiceError, searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import {
  PLACES_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

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
    return NextResponse.json(
      { error: "invalid_request", message: "lat/lng must both be numbers" },
      { status: 400 },
    );
  }
  if (q === "" && !hasCoords) {
    return NextResponse.json(
      { error: "invalid_request", message: "q or lat+lng required" },
      { status: 400 },
    );
  }
  if (Number.isNaN(r) || r <= 0) {
    return NextResponse.json(
      { error: "invalid_request", message: "r must be a positive number (km)" },
      { status: 400 },
    );
  }
  if (source !== "stored" && source !== "google") {
    return NextResponse.json(
      { error: "invalid_request", message: "source must be stored or google" },
      { status: 400 },
    );
  }
  if (source === "google" && q === "") {
    return NextResponse.json(
      { error: "invalid_request", message: "q is required for Google search" },
      { status: 400 },
    );
  }

  const clampedR = Math.min(r, MAX_SEARCH_RADIUS_KM);

  const user = await getCurrentUser();
  // Live Google search bills per request; only the signed-in creation flow may
  // trigger it. Stored-cache search stays public for the discovery surface.
  if (source === "google" && !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const clientId = getClientIdentifier(request, user);
  const limit = await rateLimiter.check(
    `places:${clientId}`,
    PLACES_RATE_LIMIT.windowMs,
    PLACES_RATE_LIMIT.maxRequests,
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
      return NextResponse.json({ error: "poi_service", message: err.message }, { status: err.status });
    }
    console.error("/api/places/search failed", err);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
