import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import { parseNavigationBody, recordNavigation } from "@/lib/db/navigations";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/navigations  {cafe_id}
 * Records the "导航" tap that drives the ClassPass-style "did you visit?"
 * prompt on the next visit (spec 0001). Requires auth; 404 when the cafe
 * does not exist.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseNavigationBody(bodyRes.data);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "POST /api/navigations",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const navigation = await recordNavigation(user.id, parsed.value.cafe_id);
    return NextResponse.json(navigation, { status: 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
