import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import {
  cafeExists,
  deleteCafe,
  getCafe,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import {
  CafeForbiddenError,
  CafeHasOtherCheckinsError,
} from "@/lib/validation/cafe";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import { guard, readJsonBody } from "@/lib/api/guard";
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

  const gate = await guard(request, {
    bucket: "cafes-read",
    route: "GET /api/cafes/[id]",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const cafe = await getCafe(id, user?.id);
    if (!cafe) {
      return apiError("not_found", "cafe not found", 404);
    }
    return NextResponse.json(toPublicCafeDetail(cafe));
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: 500 });
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

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "DELETE /api/cafes/[id]",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const exists = await cafeExists(id, user.id);
    if (!exists) {
      return apiError("not_found", "cafe not found", 404);
    }

    const bodyRes = await readJsonBody<{ confirm?: unknown }>(request, {
      optional: true,
    });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    const confirm =
      typeof body === "object" && body !== null && body.confirm === true;

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
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
