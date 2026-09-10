import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { POIServiceError, resolveMapsUrl } from "@/lib/places/poi-client";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";
import { guard, readJsonBody } from "@/lib/api/guard";
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

  const gate = await guard(request, {
    bucket: "places",
    route: "POST /api/places/resolve",
  });
  if (!gate.ok) return gate.response;

  const bodyRes = await readJsonBody<Record<string, unknown>>(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;
  const mapsShareUrl: unknown =
    body && typeof body === "object" && "maps_share_url" in body
      ? body.maps_share_url
      : undefined;
  if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
    return apiError("invalid_request", "maps_share_url (string) required", 400);
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
    logError({ route: "POST /api/places/resolve", requestId: getRequestId(request), error: err, status: 502 });
    return apiError("upstream_error", 502);
  }
}
