import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";
import { parseLocateBody } from "@/lib/validation/onboarding";
import { resolveLocatedCity } from "@/lib/onboarding";
import { updateProfile } from "@/lib/db/profile";

/**
 * POST /api/onboarding/locate  {lat, lng}
 *
 * Resolves a granted geolocation to the user's current city (spec 0001
 * §Onboarding, DG121) and, for signed-in users, persists `current_city` +
 * `last_location` + `onboarded` in one write — the grant dismisses the
 * welcome card, so the profile flag flips here (DG122). Anonymous callers
 * get resolution only; their state stays in localStorage.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseLocateBody(bodyRes.data);
  if (!parsed.ok) {
    return apiError(parsed.error, parsed.status);
  }

  const gate = await guard(request, {
    bucket: "onboarding",
    requireAuth: false,
    route: "POST /api/onboarding/locate",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { city, inCoverage } = resolveLocatedCity(parsed.lat, parsed.lng, request.headers);

  if (user) {
    try {
      await updateProfile(user.id, {
        onboarded: true,
        lastLocation: { lat: parsed.lat, lng: parsed.lng },
        ...(city ? { currentCity: city.id } : {}),
      });
    } catch (error) {
      logError({ route: gate.route, request, error, status: 500 });
      return apiError("internal_error", 500);
    }
  }

  return NextResponse.json({ city, inCoverage });
}
