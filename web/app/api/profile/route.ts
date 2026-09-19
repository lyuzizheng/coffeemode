import { logError } from "@/lib/observability/server-log";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/response";
import { deleteAccount, getProfile, getUserStats, updateProfile } from "@/lib/db/profile";
import { parseProfilePatch } from "@/lib/validation/profile";
import { requireSameOrigin } from "@/lib/security/origin";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
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
    logError({ route: gate.route, request, error, status: 500 });
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
    logError({ route: gate.route, request, error, status: 500 });
    return apiError("internal_error", 500);
  }
}

/**
 * DELETE /api/profile (BRAWUKA-504, DG149): permanent account teardown.
 * The DB transaction soft-deletes check-ins (DG146 semantics), hands
 * created cafes to the service account, and removes likes, navigations,
 * upload intents, and the profile row. The Supabase auth user is then
 * deleted via the admin API when SUPABASE_SERVICE_ROLE_KEY is configured;
 * without it the session is still signed out and the app-level account is
 * gone (a re-login would start a fresh profile — acceptable degradation,
 * flagged in spec 0004 DG149).
 */
export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "profile-write",
    requireAuth: true,
    route: "DELETE /api/profile",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const result = await deleteAccount(user.id);

    // Auth-side teardown, best-effort after the data commit: the admin
    // delete needs the service-role key; sign-out clears the session
    // cookies either way so the deleted account can't keep browsing.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (serviceKey && supabaseUrl) {
      try {
        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await admin.auth.admin.deleteUser(user.id);
        if (error) {
          logError({ route: gate.route, request, error, status: 502 });
        }
      } catch (error) {
        logError({ route: gate.route, request, error, status: 502 });
      }
    }

    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch (error) {
      logError({ route: gate.route, request, error, status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    logError({ route: gate.route, request, error, status: 500 });
    return apiError("internal_error", 500);
  }
}
