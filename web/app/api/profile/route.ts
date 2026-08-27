import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { getProfile, getUserStats, parseProfilePatch, updateProfile } from "@/lib/db/profile";
import { requireSameOrigin } from "@/lib/security/origin";
import { rateLimitBuckets } from "@/lib/config";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "profile-read",
    clientId,
    rateLimitBuckets("profile-read"),
    "GET /api/profile",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

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
    console.error("GET /api/profile failed:", error);
    return apiError("internal_error", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const patchClientId = getClientIdentifier(request, user);
  const patchRate = await checkRateLimit(
    "profile-write",
    patchClientId,
    rateLimitBuckets("profile-write"),
    "PATCH /api/profile",
  );
  if (!patchRate.allowed) return rateLimitResponse(patchRate);

  const body = await request.json().catch(() => null);
  const parsed = parseProfilePatch(body);
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
    console.error("PATCH /api/profile failed:", error);
    return apiError("internal_error", 500);
  }
}
