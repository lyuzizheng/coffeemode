import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { POIServiceError, resolveMapsUrl } from "@/lib/places/poi-client";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";
import {
  PLACES_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

/**
 * POST /api/places/resolve  {maps_share_url}
 * Proxy to the POI cache service resolve — turns a pasted Google Maps link
 * into a POI (cafe creation import path). Short links are followed by the
 * worker; this route validates the host before proxying.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mapsShareUrl: unknown =
    body && typeof body === "object" && "maps_share_url" in body
      ? (body as Record<string, unknown>).maps_share_url
      : undefined;
  if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
    return NextResponse.json(
      { error: "invalid_request", message: "maps_share_url (string) required" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const limit = await rateLimiter.check(
    `places:${clientId}`,
    PLACES_RATE_LIMIT.windowMs,
    PLACES_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  const trimmedUrl = mapsShareUrl.trim();
  if (!isValidMapsUrl(trimmedUrl)) {
    return NextResponse.json(
      { error: "invalid_maps_url", message: "only Google Maps and Apple Maps URLs are allowed" },
      { status: 400 },
    );
  }

  try {
    const poi = await resolveMapsUrl(trimmedUrl);
    return NextResponse.json(poi);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return NextResponse.json({ error: "poi_service", message: err.message }, { status: err.status });
    }
    console.error("/api/places/resolve failed", err);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
