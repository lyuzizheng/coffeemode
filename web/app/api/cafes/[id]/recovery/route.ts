import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  findLiveCafeByExternalId,
  getCafeLocation,
  getCafeProbe,
  listCafesNearby,
} from "@/lib/db/cafes";
import { appConfig, rateLimitBuckets } from "@/lib/config";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/cafes/[id]/recovery
 * Nearby-cafe suggestions for the gone-cafe 404 (DG111): cafes near the
 * requested cafe's last known location, excluding the cafe itself. The
 * block never uses the user's geolocation (DG112). Anonymous read, rate
 * limited with the cafes-read bucket. An unknown cafe simply yields an
 * empty list — the caller is already on the 404 page.
 *
 * NOTE: Soft-deleted cafes retain location tombstones (deleted_at is not null)
 * so recovery suggestions find nearby active alternatives (issue #207).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-read",
    clientId,
    rateLimitBuckets("cafes-read"),
    "GET /api/cafes/[id]/recovery",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const location = await getCafeLocation(id);
    if (!location) {
      return NextResponse.json({ cafes: [], replacement_id: null });
    }
    const probe = await getCafeProbe(id);
    let replacementId: string | null = null;
    if (probe && probe.deleted_at !== null) {
      replacementId = await findLiveCafeByExternalId(
        probe.google_place_id,
        probe.apple_poi_id,
        id,
      );
    }
    // Fetch one extra row so excluding the cafe itself still fills the limit.
    const nearby = await listCafesNearby({
      lat: location.lat,
      lng: location.lng,
      radiusKm: appConfig.search.maxRadiusKm,
      limit: appConfig.seo.recoveryLimit + 1,
    });
    const cafes = nearby.filter((cafe) => cafe.id !== id).slice(0, appConfig.seo.recoveryLimit);
    return NextResponse.json({ cafes, replacement_id: replacementId });
  } catch (err) {
    console.error("/api/cafes/[id]/recovery GET failed", err);
    return apiError("internal_error", 500);
  }
}
