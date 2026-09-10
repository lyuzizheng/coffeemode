import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/response";
import { getProfile, getUserStats, parseProfilePatch, updateProfile } from "@/lib/db/profile";
import { requireSameOrigin } from "@/lib/security/origin";
import { guard, readJsonBody } from "@/lib/api/guard";

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    bucket: "profile-read",
    requireAuth: true,
    route: "GET /api/profile",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const [profile, stats] = await Promise.all([
      getProfile(user.id),
      getUserStats(user.id),
    ]);

    if (!profile) {
      return apiError("profile_not_found", 404);
    }

    return NextResponse.json({
      profile,
      stats,
    });
  } catch (error) {
    logError({ route: "GET /api/profile", requestId: getRequestId(request), error, status: 500 });
    return apiError("internal_error", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "profile-write",
    requireAuth: true,
    route: "PATCH /api/profile",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseProfilePatch(bodyRes.data);
  if (!parsed.ok) {
    return apiError(parsed.error, parsed.status);
  }

  try {
    const updated = await updateProfile(user.id, parsed.patch);
    if (!updated) {
      return apiError("profile_not_found", 404);
    }

    return NextResponse.json({ profile: updated });
  } catch (error) {
    logError({ route: "PATCH /api/profile", requestId: getRequestId(request), error, status: 500 });
    return apiError("internal_error", 500);
  }
}
