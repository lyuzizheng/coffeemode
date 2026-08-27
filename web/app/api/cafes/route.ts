import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";
import {
  CafeExistsError,
  createCafeWithFirstCheckIn,
  listCafesNearby,
  parseCreateCafeBody,
} from "@/lib/db/cafes";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
} from "@/lib/places/constants";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { appConfig, rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";

// `cafes.listLimitMax` in web/config/app.yaml (DG107).
const MAX_LIST_LIMIT = appConfig.cafes.listLimitMax;

/**
 * GET /api/cafes?lat=&lng=&radius_km=&limit=
 * Nearby cafes (own POI database), closest first. Anonymous read, rate
 * limited; radius clamps to the 10 km cap like the places search proxy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");
  // Number(null) === 0, so presence must be checked before conversion.
  const lat = latParam === null ? NaN : Number(latParam);
  const lng = lngParam === null ? NaN : Number(lngParam);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return apiError("invalid_request", "lat and lng query params (numbers) required", 400);
  }
  // Out-of-range coordinates would make PostGIS throw — reject as a 400 instead.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return apiError("invalid_request", "lat must be within [-90,90], lng within [-180,180]", 400);
  }

  const radiusParam = url.searchParams.get("radius_km");
  const radius = radiusParam === null ? DEFAULT_SEARCH_RADIUS_KM : Number(radiusParam);
  if (!Number.isFinite(radius) || radius <= 0) {
    return apiError("invalid_request", "radius_km must be a positive number", 400);
  }
  const radiusKm = Math.min(radius, MAX_SEARCH_RADIUS_KM);

  const limitParam = url.searchParams.get("limit");
  const limit = parseQueryPositiveInt(limitParam, MAX_LIST_LIMIT, MAX_LIST_LIMIT);
  if (limit === null) {
    return apiError("invalid_request", "limit must be a positive integer", 400);
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-read",
    clientId,
    rateLimitBuckets("cafes-read"),
    "GET /api/cafes",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafes = await listCafesNearby({ lat, lng, radiusKm, limit });
    return NextResponse.json({ cafes });
  } catch (err) {
    console.error("/api/cafes GET failed", err);
    return apiError("internal_error", 500);
  }
}

/**
 * POST /api/cafes  {name, lat, lng, ..., checkin: {scores, photo_ids, ...}}
 * Create a cafe fused with the creator's first check-in (spec 0001) plus
 * the work_stats fold — one transaction. Requires auth. 409 when the
 * external POI id is already registered (dedupe). Photos are image UUIDs
 * from /api/images/upload; the server provisions and derives them
 * (issue #86) — 400 invalid_photos when an id was not issued to the
 * caller or was already consumed.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => null);
  const parsed = parseCreateCafeBody(body);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "POST /api/cafes",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const result = await createCafeWithFirstCheckIn(user.id, parsed.value);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CafeExistsError) {
      return apiError("cafe_exists", 409, { cafe_id: err.existingCafeId });
    }
    if (
      err instanceof PhotoIntentError ||
      // The caller's own upload never landed in R2 (worker 404) — same
      // user-facing class as a bad photo id, not a server fault.
      (err instanceof ImageServiceError && err.status === 404)
    ) {
      return apiError("invalid_photos", "one or more photos are invalid", 400);
    }
    console.error("/api/cafes POST failed", err);
    return apiError("internal_error", 500);
  }
}
