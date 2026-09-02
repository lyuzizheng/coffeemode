import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  cafeExists,
  CafeForbiddenError,
  CafeHasOtherCheckinsError,
  deleteCafe,
  getCafe,
  toPublicCafeDetail,
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

/**
 * GET /api/cafes/[id]
 * Single cafe detail. Anonymous read, rate limited; 404 when missing.
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
    "GET /api/cafes/[id]",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafe = await getCafe(id);
    if (!cafe) {
      return apiError("not_found", "cafe not found", 404);
    }
    return NextResponse.json(toPublicCafeDetail(cafe));
  } catch (err) {
    console.error("/api/cafes/[id] GET failed", err);
    return apiError("internal_error", 500);
  }
}

/**
 * DELETE /api/cafes/[id]
 * Checkin-scoped cafe delete (DG125 / issue #229). Auth required; only creator can delete.
 */
export async function DELETE(
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
    "DELETE /api/cafes/[id]",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const exists = await cafeExists(id);
    if (!exists) {
      return apiError("not_found", "cafe not found", 404);
    }

    const body = await request.json().catch(() => null);
    const confirm =
      typeof body === "object" && body !== null && (body as { confirm?: unknown }).confirm === true;

    const result = await deleteCafe(id, user.id, { confirm });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    if (err instanceof CafeForbiddenError) {
      return apiError("forbidden", "only creator can delete cafe", 403);
    }
    if (err instanceof CafeHasOtherCheckinsError) {
      return apiError("cafe_has_other_checkins", 403, {
        code: "cafe_has_other_checkins",
        n: err.n,
      });
    }
    console.error("/api/cafes/[id] DELETE failed", err);
    return apiError("internal_error", 500);
  }
}
