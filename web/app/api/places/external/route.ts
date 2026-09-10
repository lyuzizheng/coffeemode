import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { POIServiceError, storeExternalPOIs } from "@/lib/places/poi-client";
import { MAX_EXTERNAL_BATCH_SIZE } from "@shared/places/constants";
import type { POI } from "@shared/places/types";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/places/external
 *
 * Store a POI returned by a browser-side provider search. Apple MapKit has no
 * server-side Places API, so this is the persistence boundary for its result
 * before the cafe creation request uses the Apple reference.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "places",
    requireAuth: true,
    route: "POST /api/places/external",
  });
  if (!gate.ok) return gate.response;

  const bodyRes = await readJsonBody<{ pois?: unknown }>(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;
  const pois =
    body && typeof body === "object" && "pois" in body
      ? (body as Record<string, unknown>).pois
      : undefined;
  if (!Array.isArray(pois) || pois.length === 0) {
    return apiError("invalid_request", "pois array required", 400);
  }
  if (pois.length > MAX_EXTERNAL_BATCH_SIZE) {
    return apiError(
      "invalid_request",
      `pois array must contain at most ${MAX_EXTERNAL_BATCH_SIZE} items`,
      400,
    );
  }
  if (
    !pois.every(
      (poi) =>
        poi !== null &&
        typeof poi === "object" &&
        (poi as Record<string, unknown>).source === "apple",
    )
  ) {
    return apiError(
      "invalid_request",
      "only Apple MapKit POIs may be stored from the browser",
      400,
    );
  }


  try {
    const result = await storeExternalPOIs(pois as POI[]);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return apiError("poi_service", err.message, err.status);
    }
    console.error("/api/places/external failed", err);
    return apiError("upstream_error", 502);
  }
}
