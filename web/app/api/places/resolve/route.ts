import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { POIServiceError, resolveMapsUrl } from "@/lib/places/poi-client";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/places/resolve  {maps_share_url}
 * Proxy to the POI cache service resolve — turns a pasted Google Maps link
 * into a POI (cafe creation import path). Short links are followed by the
 * worker; this route validates the host before proxying.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => null);
  const mapsShareUrl: unknown =
    body && typeof body === "object" && "maps_share_url" in body
      ? (body as Record<string, unknown>).maps_share_url
      : undefined;
  if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
    return apiError("invalid_request", "maps_share_url (string) required", 400);
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const limit = await checkRateLimit(
    "places",
    clientId,
    rateLimitBuckets("places"),
    "POST /api/places/resolve",
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  const trimmedUrl = mapsShareUrl.trim();
  if (!isValidMapsUrl(trimmedUrl)) {
    return apiError("invalid_maps_url", "only Google Maps and Apple Maps URLs are allowed", 400);
  }

  try {
    const poi = await resolveMapsUrl(trimmedUrl);
    return NextResponse.json(poi);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return apiError("poi_service", err.message, err.status);
    }
    console.error("/api/places/resolve failed", err);
    return apiError("upstream_error", 502);
  }
}
