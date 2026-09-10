import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/response";
import { requireSameOrigin } from "@/lib/security/origin";
import { guard, readJsonBody } from "@/lib/api/guard";
import {
  updateProfileIdentity,
  InvalidHandleError,
  HandleTakenError,
  HandleChangeTooSoonError,
  ProfileNotFoundError,
} from "@/lib/db/identity";

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "identity-write",
    requireAuth: true,
    route: "PATCH /api/profile/identity",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("invalid_request", "invalid JSON body", 400);
  }

  const raw = body as { showPublicIdentity?: unknown; publicHandle?: unknown };

  if (typeof raw.showPublicIdentity !== "boolean") {
    return apiError("invalid_request", "showPublicIdentity (boolean) required", 400);
  }

  if (raw.publicHandle !== undefined && typeof raw.publicHandle !== "string") {
    return apiError("invalid_request", "publicHandle must be a string", 400);
  }

  try {
    const result = await updateProfileIdentity(user.id, {
      showPublicIdentity: raw.showPublicIdentity,
      publicHandle: raw.publicHandle as string | undefined,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof InvalidHandleError) {
      return apiError("invalid_handle", 400);
    }
    if (err instanceof HandleTakenError) {
      return apiError("handle_taken", 409);
    }
    if (err instanceof HandleChangeTooSoonError) {
      return apiError("handle_change_too_soon", 400);
    }
    if (err instanceof ProfileNotFoundError) {
      return apiError("profile_not_found", 404);
    }
    logError({ route: "PATCH /api/profile/identity", requestId: getRequestId(request), error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
