// --- GET /poi/search ---

import { json } from "../auth";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "../constants";
import type { Deps, Env, POISearchHit } from "../types";
import { d1SearchPOIs } from "../store";
import { inLatRange, inLngRange, parseQueryNumber } from "./shared";

export async function searchPOIs(request: Request, env: Env, _deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const lat = parseQueryNumber(url.searchParams.get("lat"));
  const lng = parseQueryNumber(url.searchParams.get("lng"));
  const rRaw = url.searchParams.get("r");
  const r = rRaw ? parseQueryNumber(rRaw) : DEFAULT_SEARCH_RADIUS_KM;

  // Validate coordinates when provided: finite AND in range (rejects Infinity, 1e15).
  const latProvided = url.searchParams.has("lat");
  const lngProvided = url.searchParams.has("lng");
  if (latProvided || lngProvided) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLatRange(lat) || !inLngRange(lng)) {
      return json(
        { error: "invalid_request", message: "lat/lng must be finite numbers in [-90,90] / [-180,180]" },
        400,
        request,
      );
    }
  }
  const hasCoords = latProvided && lngProvided;
  if (q === "" && !hasCoords) {
    return json({ error: "invalid_request", message: "q or lat+lng required" }, 400, request);
  }
  if (!Number.isFinite(r) || r <= 0) {
    return json({ error: "invalid_request", message: "r must be a positive number (km)" }, 400, request);
  }
  if (r > MAX_SEARCH_RADIUS_KM) {
    return json(
      { error: "invalid_request", message: `r must be ≤ ${MAX_SEARCH_RADIUS_KM} km` },
      400,
      request,
    );
  }

  const hits: POISearchHit[] = await d1SearchPOIs(env.POI_DB, {
    q: q || undefined,
    lat: hasCoords ? lat : undefined,
    lng: hasCoords ? lng : undefined,
    radiusKm: r,
  });
  return json({ results: hits }, request);
}
