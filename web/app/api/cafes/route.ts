import { NextResponse } from "next/server";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { createCafeWithFirstCheckIn, listCafesNearby } from "@/lib/db/cafes";
import { parseCreateCafeBody } from "@/lib/validation/cafe";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
} from "@/lib/places/constants";
import { appConfig } from "@/lib/config";
import { readJsonBody } from "@/lib/api/guard";

// `cafes.listLimitMax` in web/config/app.yaml (DG107).
const MAX_LIST_LIMIT = appConfig.cafes.listLimitMax;

/**
 * GET /api/cafes?lat=&lng=&radius_km=&limit=
 * Nearby cafes (own POI database), closest first. Anonymous read, rate
 * limited; radius clamps to the 10 km cap like the places search proxy.
 */
export const GET = apiRoute(
  { bucket: "cafes-read", route: "GET /api/cafes" },
  async (request, ctx) => {
    const url = new URL(request.url);
    const latParam = url.searchParams.get("lat");
    const lngParam = url.searchParams.get("lng");
    // Number(null) === 0, so presence must be checked before conversion.
    const lat = latParam === null ? NaN : Number(latParam);
    const lng = lngParam === null ? NaN : Number(lngParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return apiError("invalid_request", "lat and lng query params (numbers) required", { status: 400, requestId: ctx.requestId });
    }
    // Out-of-range coordinates would make PostGIS throw — reject as a 400 instead.
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return apiError("invalid_request", "lat must be within [-90,90], lng within [-180,180]", { status: 400, requestId: ctx.requestId });
    }

    const radiusParam = url.searchParams.get("radius_km");
    const radius = radiusParam === null ? DEFAULT_SEARCH_RADIUS_KM : Number(radiusParam);
    if (!Number.isFinite(radius) || radius <= 0) {
      return apiError("invalid_request", "radius_km must be a positive number", { status: 400, requestId: ctx.requestId });
    }
    const radiusKm = Math.min(radius, MAX_SEARCH_RADIUS_KM);

    const limitParam = url.searchParams.get("limit");
    const limit = parseQueryPositiveInt(limitParam, MAX_LIST_LIMIT, MAX_LIST_LIMIT);
    if (limit === null) {
      return apiError("invalid_request", "limit must be a positive integer", { status: 400, requestId: ctx.requestId });
    }

    const cafes = await listCafesNearby({ lat, lng, radiusKm, limit, viewerId: ctx.user?.id });
    return NextResponse.json({ cafes });
  },
);

/**
 * POST /api/cafes  {name, lat, lng, ..., checkin: {scores, photo_ids, ...}}
 * Create a cafe fused with the creator's first check-in (spec 0001) plus
 * the work_stats fold — one transaction. Requires auth. 409 when the
 * external POI id is already registered (dedupe). Photos are image UUIDs
 * from /api/images/upload; the server provisions and derives them
 * (issue #86) — 422 invalid_photos when an id was not issued to the
 * caller or was already consumed.
 */
export const POST = apiRoute(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/cafes" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseCreateCafeBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError("invalid_request", parsed.message, { status: 400, requestId: ctx.requestId });
    }

    const result = await createCafeWithFirstCheckIn(ctx.user.id, parsed.value);
    return NextResponse.json(result, { status: 201 });
  },
);
