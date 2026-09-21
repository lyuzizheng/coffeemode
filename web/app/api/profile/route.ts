import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { deleteAccount, getProfile, getUserStats, updateProfile } from "@/lib/db/profile";
import { parseProfilePatch } from "@/lib/validation/profile";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { readJsonBody } from "@/lib/api/guard";
import { logError } from "@/lib/observability/server-log";

export const GET = apiRoute(
  { bucket: "profile-read", auth: "required", route: "GET /api/profile" },
  async (_request, ctx) => {
    const [profile, stats] = await Promise.all([
      getProfile(ctx.user.id),
      getUserStats(ctx.user.id),
    ]);

    if (!profile) {
      return apiError("profile_not_found", 404, { requestId: ctx.requestId });
    }

    return NextResponse.json({
      profile,
      stats,
    });
  },
);

export const PATCH = apiRoute(
  { bucket: "profile-write", auth: "required", origin: true, route: "PATCH /api/profile" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseProfilePatch(bodyRes.data);
    if (!parsed.ok) {
      return apiError(parsed.error, parsed.status, { requestId: ctx.requestId });
    }

    const updated = await updateProfile(ctx.user.id, parsed.patch);
    if (!updated) {
      return apiError("profile_not_found", 404, { requestId: ctx.requestId });
    }

    return NextResponse.json({ profile: updated });
  },
);

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
export const DELETE = apiRoute(
  { bucket: "profile-write", auth: "required", origin: true, route: "DELETE /api/profile" },
  async (_request, ctx) => {
    const result = await deleteAccount(ctx.user.id);

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
        const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
        if (error) {
          logError({ route: ctx.route, requestId: ctx.requestId, error, status: 502 });
        }
      } catch (error) {
        logError({ route: ctx.route, requestId: ctx.requestId, error, status: 502 });
      }
    }

    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch (error) {
      logError({ route: ctx.route, requestId: ctx.requestId, error, status: 500 });
    }

    return NextResponse.json(result);
  },
);
