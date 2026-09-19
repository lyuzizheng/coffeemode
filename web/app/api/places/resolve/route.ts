import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { POIServiceError, resolveMapsUrl } from "@/lib/places/poi-client";
import { isValidMapsUrl } from "@/lib/places/validate-maps-url";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

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
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "places",
    route: "POST /api/places/resolve",
  });
  if (!gate.ok) return gate.response;

  const bodyRes = await readJsonBody<Record<string, unknown>>(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("invalid_request", "invalid JSON body", { status: 400 });
  }

  // Bot gate runs before any other validation so a missing/forged token
  // always answers 403, never a 400/422 from the input checks below.
  const turnstile = await verifyTurnstileToken(body["cf-turnstile-response"], request);
  if (!turnstile.ok) {
    return apiError("bot_verification_failed", turnstile.message, { status: 403 });
  }

  const mapsShareUrl: unknown =
    "maps_share_url" in body ? body.maps_share_url : undefined;
  if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
    return apiError("invalid_request", "maps_share_url (string) required", { status: 400 });
  }

  const trimmedUrl = mapsShareUrl.trim();
  if (!isValidMapsUrl(trimmedUrl)) {
    return apiError("invalid_maps_url", "only Google Maps and Apple Maps URLs are allowed", { status: 400 });
  }

  try {
    const poi = await resolveMapsUrl(trimmedUrl);
    return NextResponse.json(poi);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return apiError("poi_service", err.message, { status: err.status });
    }
    logError({ route: gate.route, request, error: err, status: 502 });
    return apiError("upstream_error", 502);
  }
}
