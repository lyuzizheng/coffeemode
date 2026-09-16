import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError, parseQueryNumberOrNaN } from "@/lib/api/response";
import { POIServiceError, reverseGeocode } from "@/lib/places/poi-client";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";

interface ReverseRequestBody {
  lat?: unknown;
  lng?: unknown;
}

/**
 * POST /api/places/reverse  { lat, lng }
 *
 * Proxy to POI cache service reverse geocode endpoint. Reverse geocodes
 * coordinates to a normalized food/cafe POI for map-tap cafe creation.
 * Returns { poi: POI | null }.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "places",
    requireAuth: true,
    route: "POST /api/places/reverse",
  });
  if (!gate.ok) return gate.response;

  const bodyRes = await readJsonBody<ReverseRequestBody>(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;

  const rawLat = body && typeof body === "object" ? body.lat : undefined;
  const rawLng = body && typeof body === "object" ? body.lng : undefined;

  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);

  return handleReverse(request, lat, lng, gate.route);
}

async function handleReverse(
  request: Request,
  lat: number,
  lng: number,
  route: string,
): Promise<Response> {
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return apiError("invalid_request", "lat and lng must both be numbers", 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return apiError("invalid_request", "lat must be [-90, 90] and lng [-180, 180]", 400);
  }

  try {
    const poi = await reverseGeocode({ lat, lng });
    return NextResponse.json({ poi });
  } catch (err) {
    if (err instanceof POIServiceError) {
      return apiError("poi_service", err.message, err.status);
    }
    logError({ route, request, error: err, status: 502 });
    return apiError("upstream_error", 502);
  }
}

/**
 * GET /api/places/reverse?lat&lng
 *
 * Query-string variant matching /api/places/* GET convention.
 */
export async function GET(request: Request) {
  const gate = await guard(request, {
    bucket: "places",
    requireAuth: true,
    route: "GET /api/places/reverse",
  });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const lat = parseQueryNumberOrNaN(searchParams.get("lat"));
  const lng = parseQueryNumberOrNaN(searchParams.get("lng"));

  return handleReverse(request, lat, lng, gate.route);
}
