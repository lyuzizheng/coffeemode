import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { isLiveCafe, setCafeVisibility } from "@/lib/db/cafes";
import { CafeForbiddenError } from "@/lib/validation/cafe";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import { guard, readJsonBody } from "@/lib/api/guard";
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

  const bodyRes = await readJsonBody<Record<string, unknown>>(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;
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

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "PATCH /api/cafes/[id]/visibility",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

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
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
