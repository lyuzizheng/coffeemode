import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { LAUNCH_CITIES } from "@/lib/cities";
import { resolveLocatedCity } from "@/lib/onboarding";
import { deleteAccount, getProfile, getUserStats, updateProfile } from "@/lib/db/profile";
import { parseProfilePatch, type ProfilePatch } from "@/lib/validation/profile";
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

/** Launch ids pass through; anything else re-derives from coordinates. */
function rederiveCurrentCity(
  currentCity: string,
  lastLocation?: { lat: number; lng: number },
): { cityId?: string } {
  if (LAUNCH_CITIES.some((c) => c.id === currentCity)) {
    return { cityId: currentCity };
  }
  if (!lastLocation) return {};
  const { city } = resolveLocatedCity(lastLocation.lat, lastLocation.lng);
  return { cityId: city?.id };
}

/**
 * BRAWUKA-695 (PM invariant): non-launch currentCity values must derive from
 * coordinates on the server — client-submitted non-launch values never write
 * directly. BRAWUKA-696 layers the display-only name on top: `currentCityName`
 * persists only while the final `current_city` is a non-launch value; a launch
 * id nulls it (findCity supplies launch names — the field must not be
 * redundant). A submitted city that survives re-derivation always rewrites the
 * name (submitted value or null) so a stale name can never outlive its city.
 */
async function resolveCityPatch(
  userId: string,
  patch: ProfilePatch,
): Promise<{ ok: true } | { ok: false }> {
  // The stored profile is needed when the city must re-derive from
  // last_location (no coords in the patch) or when a submitted name has to
  // be checked against the final current_city (which may stay unchanged).
  const needsProfile =
    patch.currentCityName !== undefined ||
    (patch.currentCity !== undefined && patch.lastLocation === undefined);
  const existing = needsProfile ? await getProfile(userId) : null;
  if (needsProfile && !existing) return { ok: false };

  if (patch.currentCity !== undefined) {
    const derived = rederiveCurrentCity(
      patch.currentCity,
      patch.lastLocation ?? existing?.lastLocation ?? undefined,
    );
    if (derived.cityId) {
      patch.currentCity = derived.cityId;
      // The city changed: the name must be rewritten in the same write —
      // submitted name for non-launch ids, null for launch ids.
      patch.currentCityName = LAUNCH_CITIES.some((c) => c.id === derived.cityId)
        ? null
        : (patch.currentCityName ?? null);
    } else {
      // Unresolvable city: drop the submitted name with it — a name geocoded
      // for a location that failed derivation must not relabel the old city.
      delete patch.currentCity;
      delete patch.currentCityName;
    }
  }

  if (patch.currentCityName !== undefined) {
    const finalCity = patch.currentCity ?? existing?.currentCity;
    patch.currentCityName =
      finalCity && !LAUNCH_CITIES.some((c) => c.id === finalCity)
        ? patch.currentCityName
        : null;
  }
  return { ok: true };
}

export const PATCH = apiRoute(
  { bucket: "profile-write", auth: "required", origin: true, route: "PATCH /api/profile" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseProfilePatch(bodyRes.data);
    if (!parsed.ok) {
      return apiError(parsed.error, parsed.status, { requestId: ctx.requestId });
    }

    const cityRes = await resolveCityPatch(ctx.user.id, parsed.patch);
    if (!cityRes.ok) {
      return apiError("profile_not_found", 404, { requestId: ctx.requestId });
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
