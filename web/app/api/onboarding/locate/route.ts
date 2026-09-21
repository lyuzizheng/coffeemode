import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { readJsonBody } from "@/lib/api/guard";
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
export const POST = apiRoute(
  { bucket: "onboarding", origin: true, route: "POST /api/onboarding/locate" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseLocateBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError(parsed.error, parsed.status, { requestId: ctx.requestId });
    }

    const { city, inCoverage } = resolveLocatedCity(parsed.lat, parsed.lng, request.headers);

    if (ctx.user) {
      const updated = await updateProfile(ctx.user.id, {
        onboarded: true,
        lastLocation: { lat: parsed.lat, lng: parsed.lng },
        ...(city ? { currentCity: city.id } : {}),
      });
      if (!updated) {
        return apiError("profile_not_found", 404, { requestId: ctx.requestId });
      }
    }

    return NextResponse.json({ city, inCoverage });
  },
);
