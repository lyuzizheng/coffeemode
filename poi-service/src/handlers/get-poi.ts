// --- GET /poi/:place_id ---

import { json } from "../auth";
import { logError } from "../../../web/shared/log";
import { getUpstreamProvider, matchesFoodCategory, resolveUpstreamSource } from "../upstream";
import type { Deps, Env, POI } from "../types";
import { d1GetPOI, d1UpsertPOI, isFresh, kvGetPOI, kvPutPOI } from "../store";
import { upstreamError } from "./shared";

export async function getPOI(
  placeId: string,
  env: Env,
  deps: Deps,
  request: Request,
  sessionToken?: string,
): Promise<Response> {
  // 1. KV hot cache (normalized POI record, ~7d TTL). Probing for Apple refs is
  // safe — they are simply never cached in KV.
  const cached = await kvGetPOI(env.POI_KV, placeId);
  if (cached) {
    try {
      return json(JSON.parse(cached) as POI, request);
    } catch {
      // corrupt cache entry — fall through to D1/Google
    }
  }

  // 2. D1 bounded cache. The stored row's explicit `source` is authoritative
  // (issue #38): an Apple ref that happens to start with ChIJ/0x must not be
  // fanned out to Google, and a non-prefix Google id must still refresh.
  const stored = await d1GetPOI(env.POI_DB, placeId);

  // Apple POIs have no server-side upstream — serve what's stored.
  if (stored && stored.source === "apple") return json(stored, request);
  if (stored && isFresh(stored)) return json(stored, request);

  // 3. Resolve upstream provider: stored row's source is authoritative;
  // for never-seen ids, fall back to provider heuristic (isGooglePlaceId).
  const source = resolveUpstreamSource(placeId, stored?.source);
  if (!source) {
    return json({ error: "not_found" }, 404, request);
  }

  const provider = getUpstreamProvider(source, env, deps);
  if (!provider) {
    if (stored) return json(stored, request);
    return json({ error: "not_found" }, 404, request);
  }

  // 4. Upstream API → backfill both. The session token (when the caller
  // carries one) terminates the Autocomplete session that produced this id,
  // which is what makes the typing phase free.
  let rawPlace: unknown;
  try {
    rawPlace = await provider.getDetails(placeId, sessionToken);
  } catch (e) {
    // Graceful degradation: serve stale D1 row if we have one (d1GetPOI guarantees unexpired).
    if (stored) return json(stored, request);
    return upstreamError(request, e);
  }

  let poi: POI;
  try {
    poi = provider.toPOI(rawPlace); // rejects places missing `location` instead of storing (0,0)
  } catch {
    // P0 scrub: the validator message carries the upstream place id —
    // details, not a body field. Canned code only.
    if (stored) return json(stored, request);
    return json({ error: "invalid_upstream" }, 502, request);
  }
  // BRAWUKA-441 — DG144/DG52 category gate on the last ungated write path:
  // a place that resolves upstream but is not food/cafe is never persisted
  // (D1/KV) and answers not_found, so it can neither enter the cache nor
  // verify as a cafe reference. Stored rows are served before this point, so
  // the gate only shapes what enters the cache.
  if (!matchesFoodCategory(poi.source, poi.types)) {
    return json({ error: "not_found", message: "not a food or cafe place" }, 404, request);
  }
  try {
    await Promise.all([kvPutPOI(env.POI_KV, poi), d1UpsertPOI(env.POI_DB, poi)]);
  } catch (e) {
    logError({ route: "GET /poi/:place_id", request, error: e, status: 200 });
  }
  return json(poi, request);
}
