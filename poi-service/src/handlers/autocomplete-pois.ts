// --- GET /poi/autocomplete ---

import { json } from "../auth";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM, SEARCH_RESULT_LIMIT } from "../constants";
import { getUpstreamProvider } from "../upstream";
import type { Deps, Env, PlacePrediction } from "../types";
import {
  SESSION_TOKEN_RE,
  inLatRange,
  inLngRange,
  parseQueryNumber,
  upstreamError,
} from "./shared";

/**
 * Typing-phase suggestions for the creation/search entry point.
 *
 * Nothing is persisted: a prediction carries no coordinates, so there is no
 * POI to store. The billed Place Details call happens on selection
 * (`GET /poi/:place_id?session=…`), which is the whole point of this split.
 */
export async function autocompletePOIs(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const session = url.searchParams.get("session")?.trim() ?? "";
  // Strict `Number` via parseQueryNumber (shared with searchPOIs): `Number("10abc")`
  // is NaN where `parseFloat` would have silently returned 10.
  const lat = parseQueryNumber(url.searchParams.get("lat"));
  const lng = parseQueryNumber(url.searchParams.get("lng"));
  const r = url.searchParams.has("r") ? parseQueryNumber(url.searchParams.get("r")) : DEFAULT_SEARCH_RADIUS_KM;

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
  if (q === "") return json({ error: "invalid_request", message: "q is required" }, 400, request);
  if (!SESSION_TOKEN_RE.test(session)) {
    return json(
      { error: "invalid_request", message: "session must be a UUID (Autocomplete session token)" },
      400,
      request,
    );
  }
  if (!Number.isFinite(r) || r <= 0 || r > MAX_SEARCH_RADIUS_KM) {
    return json(
      { error: "invalid_request", message: `r must be between 0 and ${MAX_SEARCH_RADIUS_KM} km` },
      400,
      request,
    );
  }

  const provider = getUpstreamProvider("google", env, deps);
  if (!provider) {
    return json({ error: "upstream_error", message: "google provider not available" }, 502, request);
  }

  let predictions: PlacePrediction[];
  try {
    predictions = await provider.autocomplete(q, {
      lat: latProvided ? lat : undefined,
      lng: lngProvided ? lng : undefined,
      radiusKm: r,
      sessionToken: session,
    });
  } catch (e) {
    return upstreamError(request, e);
  }

  return json({ predictions: predictions.slice(0, SEARCH_RESULT_LIMIT) }, request);
}
