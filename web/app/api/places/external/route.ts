import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { POIServiceError, storeExternalPOIs } from "@/lib/places/poi-client";
import type { POI } from "@shared/places/types";
import {
  PLACES_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

/**
 * POST /api/places/external
 *
 * Store a POI returned by a browser-side provider search. Apple MapKit has no
 * server-side Places API, so this is the persistence boundary for its result
 * before the cafe creation request uses the Apple reference.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const pois =
    body && typeof body === "object" && "pois" in body
      ? (body as Record<string, unknown>).pois
      : undefined;
  if (!Array.isArray(pois) || pois.length === 0) {
    return NextResponse.json(
      { error: "invalid_request", message: "pois array required" },
      { status: 400 },
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
    return NextResponse.json(
      { error: "invalid_request", message: "only Apple MapKit POIs may be stored from the browser" },
      { status: 400 },
    );
  }

  const clientId = getClientIdentifier(request, user);
  const limit = await rateLimiter.check(
    `places:${clientId}`,
    PLACES_RATE_LIMIT.windowMs,
    PLACES_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) return rateLimitResponse(limit);

  try {
    const result = await storeExternalPOIs(pois as POI[]);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return NextResponse.json({ error: "poi_service", message: err.message }, { status: err.status });
    }
    console.error("/api/places/external failed", err);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
