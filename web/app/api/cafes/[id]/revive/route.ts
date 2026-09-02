import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  findLiveCafeByExternalId,
  getCafeProbe,
  reviveCafe,
} from "@/lib/db/cafes";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";
import { isValidUUID } from "@shared/uuid";

/**
 * POST /api/cafes/[id]/revive
 * Revive a soft-deleted cafe (issue #229, DG125).
 * Auth required; only creator can revive a tombstone.
 *
 * Contract:
 * - 403: cross-origin request
 * - 400: malformed UUID
 * - 401: unauthenticated
 * - 429: rate limit exceeded (cafes-write bucket)
 * - 404: uniform not found (unknown id, already live, tomb owned by someone else, or created_by IS NULL)
 * - 409: POI conflict with { error: "conflict", replacement_id }
 * - 200: { ok: true, id }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", "authentication required", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "POST /api/cafes/[id]/revive",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const probe = await getCafeProbe(id);
    if (!probe || probe.deleted_at === null || probe.created_by !== user.id) {
      return apiError("not_found", "cafe not found", 404);
    }

    const ok = await reviveCafe(id);
    if (!ok) {
      const replacementId = await findLiveCafeByExternalId(
        probe.google_place_id,
        probe.apple_poi_id,
        id,
      );
      if (replacementId) {
        return apiError("conflict", 409, { replacement_id: replacementId });
      }
      return apiError("not_found", "cafe not found", 404);
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("/api/cafes/[id]/revive POST failed", err);
    return apiError("internal_error", 500);
  }
}
