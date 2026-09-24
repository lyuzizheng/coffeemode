// --- POST /poi/resolve ---

// Apple Maps has no server-side Places API: a share URL with coordinates but
// no stored reference falls back to the shared `stableApplePlaceId` hash.

import { json } from "../auth";
import { getUpstreamProvider, isGooglePlaceId } from "../upstream";
import type { Deps, Env, POI, POISource, PlacePrediction } from "../types";
import { stableApplePlaceId } from "../../../web/shared/places/apple-place-id";
import { computeExpiresAt, d1GetPOI, d1UpsertPOI } from "../store";
import { resolveShareUrl } from "../url";
import { getPOI } from "./get-poi";
import { upstreamError } from "./shared";

export async function resolvePOI(request: Request, env: Env, deps: Deps): Promise<Response> {
  const body = await request.json().catch(() => null);
  const mapsUrl: unknown =
    (body && typeof body === "object" && "maps_share_url" in body
      ? (body as Record<string, unknown>).maps_share_url
      : undefined) ??
    (body && typeof body === "object" && "url" in body
      ? (body as Record<string, unknown>).url
      : undefined);
  if (typeof mapsUrl !== "string" || mapsUrl.trim() === "") {
    return json({ error: "invalid_request", message: "maps_share_url (string) required" }, 400, request);
  }

  const target = await resolveShareUrl(mapsUrl.trim(), deps.fetchImpl);
  if (target.source === "apple") {
    // Apple Maps has no server-side Places API. A share URL still gives us
    // enough data to create a durable POI when it contains coordinates; an
    // already stored Apple reference remains authoritative.
    //
    // BRAWUKA-566: never let an attacker-controlled auid become the D1 row
    // key for someone else's POI. A Google-shaped auid
    // (maps.apple.com/?auid=<google-id>) would replace the canonical Google
    // row and getPOI would serve the forgery forever, so those URLs are
    // unresolvable; and when a stored row of the other source already owns
    // the key, an apple write must not overwrite it.
    if (target.placeId && isGooglePlaceId(target.placeId)) {
      return json(
        { error: "unresolvable", message: "Apple Maps URL carries a non-Apple place id" },
        422,
        request,
      );
    }
    if (target.placeId) {
      const stored = await d1GetPOI(env.POI_DB, target.placeId);
      if (stored && stored.source !== "apple") {
        return json(
          { error: "unresolvable", message: "place id belongs to another source" },
          409,
          request,
        );
      }
      if (stored) return json(stored, request);
    }
    if (!target.coords) {
      return json(
        { error: "unresolvable", message: "Apple Maps URL needs a place id and coordinates" },
        422,
        request,
      );
    }
    const placeId =
      target.placeId ??
      stableApplePlaceId(`${target.coords.lat},${target.coords.lng}:${target.query ?? "place"}`);
    const now = new Date().toISOString();
    const poi: POI = {
      place_id: placeId,
      source: "apple",
      name: target.query ?? "Apple Maps place",
      lat: target.coords.lat,
      lng: target.coords.lng,
      address: target.query ?? null,
      types: [],
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: computeExpiresAt(now),
    };
    // Same source-conflict guard as storeExternal: re-check the key right
    // before writing so a concurrent Google row for this id is not replaced.
    const conflict = await d1GetPOI(env.POI_DB, placeId);
    if (conflict && conflict.source !== "apple") {
      return json({ error: "unresolvable", message: "place id belongs to another source" }, 409, request);
    }
    await d1UpsertPOI(env.POI_DB, poi);
    return json(poi, request);
  }
  if (target.placeId) return await getPOI(target.placeId, env, deps, request);

  if (target.query) {
    const source: POISource = target.source ?? "google";
    const provider = getUpstreamProvider(source, env, deps);
    if (!provider) {
      return json({ error: "unresolvable", message: `no upstream provider for ${source}` }, 422, request);
    }

    // A share URL that carries only a query string has no place id, so the
    // query has to be turned into one. Autocomplete is the free way to do
    // that; the single Place Details call inside getPOI is the only billed
    // step, and it terminates the session so the lookup itself stays free.
    const sessionToken = crypto.randomUUID();
    let predictions: PlacePrediction[];
    try {
      predictions = await provider.autocomplete(target.query, {
        lat: target.coords?.lat,
        lng: target.coords?.lng,
        sessionToken,
      });
    } catch (e) {
      return upstreamError(request, e);
    }
    const first = predictions[0];
    if (!first) return json({ error: "not_found", message: "no place matched" }, 404, request);

    // BRAWUKA-441: resolve through getPOI so the DG144/DG52 food/cafe gate
    // applies — a non-food first hit (gas station, attraction) answers
    // not_found and never enters D1/KV instead of being cached and creatable
    // as a cafe. The KV/D1 lookup also serves a cached row without a second
    // billed Details call.
    return await getPOI(first.place_id, env, deps, request, sessionToken);
  }
  return json(
    { error: "unresolvable", message: "no place_id, query, or coordinates in URL" },
    422,
    request,
  );
}
