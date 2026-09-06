import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  CafeForbiddenError,
  isLiveCafe,
  setCafeVisibility,
} from "@/lib/db/cafes";
import { CafeNotFoundError } from "@/lib/db/checkins";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";
import { isValidUUID } from "@shared/uuid";
import type { CafeVisibility } from "@/types/cafes";

/**
 * PATCH /api/cafes/[id]/visibility
 * Body: { visibility: "public" | "private" }
 * Toggles cafe visibility between 'public' and 'private' (DG147 / issue #229).
 * Reversible, creator-only toggle. Idempotent.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const body = await request.json().catch(() => null);
  const rawVisibility =
    typeof body === "object" && body !== null && "visibility" in body
      ? body.visibility
      : undefined;
  if (rawVisibility !== "public" && rawVisibility !== "private") {
    return apiError(
      "invalid_request",
      "visibility must be 'public' or 'private'",
      400,
    );
  }
  const visibility = rawVisibility as CafeVisibility;

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", "authentication required", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "PATCH /api/cafes/[id]/visibility",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const live = await isLiveCafe(id);
    if (!live) {
      return apiError("not_found", "cafe not found", 404);
    }

    const result = await setCafeVisibility(id, user.id, visibility);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    if (err instanceof CafeForbiddenError) {
      return apiError("forbidden", err.message, 403);
    }
    console.error("/api/cafes/[id]/visibility PATCH failed", err);
    return apiError("internal_error", 500);
  }
}
