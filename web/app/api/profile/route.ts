import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getProfile, getUserStats, updateProfile } from "@/lib/db/profile";
import { isSameOrigin } from "@/lib/security/origin";
import {
  checkRateLimit,
  getClientIdentifier,
  PROFILE_READ_RATE_LIMIT,
  PROFILE_WRITE_RATE_LIMIT,
  rateLimitResponse,
} from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "profile-read",
    clientId,
    [PROFILE_READ_RATE_LIMIT],
    "GET /api/profile",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const [profile, stats] = await Promise.all([
      getProfile(user.id),
      getUserStats(user.id),
    ]);

    if (!profile) {
      return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      profile,
      stats,
    });
  } catch (error) {
    console.error("GET /api/profile failed:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const patchClientId = getClientIdentifier(request, user);
  const patchRate = await checkRateLimit(
    "profile-write",
    patchClientId,
    [PROFILE_WRITE_RATE_LIMIT],
    "PATCH /api/profile",
  );
  if (!patchRate.allowed) return rateLimitResponse(patchRate);

  try {
    const body = (await request.json()) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const payload = body as { displayName?: unknown; currentCity?: unknown };
    const patch: { displayName?: string; currentCity?: string } = {};

    if (payload.displayName !== undefined) {
      if (typeof payload.displayName !== "string") {
        return NextResponse.json({ error: "invalid_display_name" }, { status: 400 });
      }
      const trimmed = payload.displayName.trim();
      if (trimmed.length === 0 || trimmed.length > 24) {
        return NextResponse.json({ error: "display_name_length" }, { status: 400 });
      }
      patch.displayName = trimmed;
    }

    if (payload.currentCity !== undefined) {
      if (typeof payload.currentCity !== "string") {
        return NextResponse.json({ error: "invalid_current_city" }, { status: 400 });
      }
      const trimmedCity = payload.currentCity.trim().toLowerCase();
      if (trimmedCity.length === 0 || trimmedCity.length > 50) {
        return NextResponse.json({ error: "current_city_length" }, { status: 400 });
      }
      patch.currentCity = trimmedCity;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "empty_patch" }, { status: 400 });
    }

    const updated = await updateProfile(user.id, patch);
    if (!updated) {
      return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
    }

    return NextResponse.json({ profile: updated });
  } catch (error) {
    console.error("PATCH /api/profile failed:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
