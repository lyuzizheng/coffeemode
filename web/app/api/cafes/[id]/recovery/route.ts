import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getCafeLocation, listCafesNearby } from "@/lib/db/cafes";
import { appConfig } from "@/lib/config";
import {
  CAFES_READ_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/cafes/[id]/recovery
 * Nearby-cafe suggestions for the gone-cafe 404 (DG111): cafes near the
 * requested cafe's last known location, excluding the cafe itself. The
 * block never uses the user's geolocation (DG112). Anonymous read, rate
 * limited with the cafes-read bucket. An unknown cafe simply yields an
 * empty list — the caller is already on the 404 page.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-read:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const location = await getCafeLocation(id);
    if (!location) {
      return NextResponse.json({ cafes: [] });
    }
    // Fetch one extra row so excluding the cafe itself still fills the limit.
    const nearby = await listCafesNearby({
      lat: location.lat,
      lng: location.lng,
      radiusKm: appConfig.search.maxRadiusKm,
      limit: appConfig.seo.recoveryLimit + 1,
    });
    const cafes = nearby.filter((cafe) => cafe.id !== id).slice(0, appConfig.seo.recoveryLimit);
    return NextResponse.json({ cafes });
  } catch (err) {
    console.error("/api/cafes/[id]/recovery GET failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
