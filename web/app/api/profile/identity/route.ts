import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { requireSameOrigin } from "@/lib/security/origin";
import { rateLimitBuckets } from "@/lib/config";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  updateProfileIdentity,
  InvalidHandleError,
  HandleTakenError,
  HandleChangeTooSoonError,
  ProfileNotFoundError,
} from "@/lib/db/identity";
import { logError } from "@/lib/observability/server-log";

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "identity-write",
    clientId,
    rateLimitBuckets("identity-write"),
    "PATCH /api/profile/identity",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
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
    logError("PATCH /api/profile/identity", err, request);
    return apiError("internal_error", 500);
  }
}
