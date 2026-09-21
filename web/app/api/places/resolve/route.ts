import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { resolveMapsUrl } from "@/lib/places/poi-client";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";
import { readJsonBody } from "@/lib/api/guard";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { logWarn } from "@/lib/observability/server-log";

/**
 * POST /api/places/resolve  {maps_share_url, cf-turnstile-response}
 * Proxy to the POI cache service resolve — turns a pasted Google Maps link
 * into a POI (cafe creation import path). Short links are followed by the
 * worker; this route validates the host before proxying.
 *
 * Anonymous but billable (worker-side short-link resolution), so every call
 * must carry a fresh `cf-turnstile-response` token minted by the
 * `places-resolve` widget (BRAWUKA-239; BRAWUKA-233 rejected WAF Managed
 * Challenge here because challenge HTML breaks `fetch()` callers).
 * Verification is fail-closed: missing/invalid token or siteverify outage
 * rejects with 403 and never reaches the worker.
 */
export const POST = apiRoute(
  { bucket: "places", origin: true, route: "POST /api/places/resolve" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody<Record<string, unknown>>(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return apiError("invalid_request", "invalid JSON body", { status: 400, requestId: ctx.requestId });
    }

    // Bot gate runs before any other validation so a missing/forged token
    // always answers 403, never a 400/422 from the input checks below.
    const turnstile = await verifyTurnstileToken(body["cf-turnstile-response"], request);
    if (!turnstile.ok) {
      // Security-relevant 4xx (spec 0011 D7): greppable without paging.
      logWarn({ route: ctx.route, requestId: ctx.requestId, error: turnstile.message, status: 403, code: "bot_verification_failed" });
      return apiError("bot_verification_failed", turnstile.message, { status: 403, requestId: ctx.requestId });
    }

    const mapsShareUrl: unknown =
      "maps_share_url" in body ? body.maps_share_url : undefined;
    if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
      return apiError("invalid_request", "maps_share_url (string) required", { status: 400, requestId: ctx.requestId });
    }

    const trimmedUrl = mapsShareUrl.trim();
    if (!isValidMapsUrl(trimmedUrl)) {
      return apiError("invalid_maps_url", "only Google Maps and Apple Maps URLs are allowed", { status: 400, requestId: ctx.requestId });
    }

    const poi = await resolveMapsUrl(trimmedUrl, ctx.requestId);
    return NextResponse.json(poi);
  },
);
