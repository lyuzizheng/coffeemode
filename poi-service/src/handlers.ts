/**
 * HTTP handlers for the POI endpoints.
 * Pure functions over injected Env/Deps — unit-testable without a Worker runtime.
 *
 * Endpoints:
 *   Unauthenticated:
 *     GET  /                 service probe
 *     GET  /health           health check
 *   Token-gated (require POI_SERVICE_TOKEN):
 *     GET  /poi/:place_id    KV hot → D1 fresh → Google API → backfill both
 *     POST /poi/resolve      {maps_share_url} → POI (creation import path)
 *     GET  /poi/search       ?q&lat&lng&r — stored POIs, name match + haversine sort
 *     GET  /poi/search/external ?q&lat&lng&r — live Google search + cache backfill
 *     POST /poi/external     store externally-searched POIs (Google live / Apple refs)
 *     POST /poi/reverse      {lat, lng} → reverse geocode to normalized food/cafe POI
 *
 * Error isolation (W1): handleFetch wraps every handler in try/catch and maps
 * uncaught D1/KV/Google failures to a JSON 500 envelope — workerd's opaque
 * default error page never escapes to callers.
 *
 * Error envelope shape is shared with image-service: { error: code, message? }.
 */

import { authorized, internalError, json, unauthorized } from "./auth";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_EXTERNAL_BATCH_SIZE,
  MAX_SEARCH_RADIUS_KM,
  SEARCH_RESULT_LIMIT,
} from "./constants";
import {
  getUpstreamProvider,
  matchesFoodCategory,
  resolveUpstreamSource,
  UpstreamApiError,
} from "./upstream";
import type { Deps, Env, POI, POISearchHit, POISource } from "./types";
import { stableApplePlaceId } from "../../web/shared/places/apple-place-id";
import {
  d1GetPOI,
  d1SearchPOIs,
  d1UpsertPOI,
  d1UpsertPOIs,
  isFresh,
  kvDeleteRaw,
  kvGetRaw,
  kvGetSearchQuery,
  kvPutRaw,
  kvPutSearchQuery,
  searchQueryKey,
} from "./store";
import { resolveShareUrl } from "./url";

// Re-exported for consumers/tests that historically imported from handlers.
export { authorized } from "./auth";


function upstreamError(e: unknown): Response {
  if (e instanceof UpstreamApiError) {
    // Scrubbed: upstream response bodies are never relayed (status only).
    return json({ error: "upstream_error", status: e.status, message: e.message }, 502);
  }
  return json({ error: "upstream_error", message: "upstream request failed" }, 502);
}

// Apple Maps has no server-side Places API: a share URL with coordinates but
// no stored reference falls back to the shared `stableApplePlaceId` hash.

// --- GET /poi/:place_id ---

async function getPOI(placeId: string, env: Env, deps: Deps): Promise<Response> {
  // 1. KV hot cache (raw Google response, ~7d TTL). KV only ever holds Google
  // payloads, so a hit proves the id is Google's regardless of its shape;
  // probing for Apple refs is safe — they are simply never cached there.
  const raw = await kvGetRaw(env.POI_KV, placeId);
  if (raw) {
    try {
      const provider = getUpstreamProvider("google", env, deps);
      if (provider) {
        return json(provider.toPOI(JSON.parse(raw)));
      }
    } catch {
      // corrupt cache entry — fall through to D1/Google
    }
  }

  // 2. D1 durable store. The stored row's explicit `source` is authoritative
  // (issue #38): an Apple ref that happens to start with ChIJ/0x must not be
  // fanned out to Google, and a non-prefix Google id must still refresh.
  const stored = await d1GetPOI(env.POI_DB, placeId);

  // Apple POIs have no server-side upstream — serve what's stored.
  if (stored && stored.source === "apple") return json(stored);
  if (stored && isFresh(stored)) return json(stored);

  // 3. Resolve upstream provider: stored row's source is authoritative;
  // for never-seen ids, fall back to provider heuristic (isGooglePlaceId).
  const source = resolveUpstreamSource(placeId, stored?.source);
  if (!source) {
    return json({ error: "not_found" }, 404);
  }

  const provider = getUpstreamProvider(source, env, deps);
  if (!provider) {
    if (stored) return json(stored);
    return json({ error: "not_found" }, 404);
  }

  // 4. Upstream API → backfill both
  let rawPlace: unknown;
  try {
    rawPlace = await provider.getDetails(placeId);
  } catch (e) {
    // Graceful degradation: serve stale D1 row if we have one.
    if (stored) return json(stored);
    return upstreamError(e);
  }

  let poi: POI;
  try {
    poi = provider.toPOI(rawPlace); // rejects places missing `location` instead of storing (0,0)
  } catch (e) {
    if (stored) return json(stored);
    return json({ error: "invalid_upstream", message: String(e) }, 502);
  }
  try {
    await Promise.all([kvPutRaw(env.POI_KV, placeId, rawPlace), d1UpsertPOI(env.POI_DB, poi)]);
  } catch (e) {
    console.error("cache write failed", e);
  }
  return json(poi);
}

// --- POST /poi/resolve ---

async function resolvePOI(request: Request, env: Env, deps: Deps): Promise<Response> {
  const body = await request.json().catch(() => null);
  const mapsUrl: unknown =
    (body && typeof body === "object" && "maps_share_url" in body
      ? (body as Record<string, unknown>).maps_share_url
      : undefined) ??
    (body && typeof body === "object" && "url" in body
      ? (body as Record<string, unknown>).url
      : undefined);
  if (typeof mapsUrl !== "string" || mapsUrl.trim() === "") {
    return json({ error: "invalid_request", message: "maps_share_url (string) required" }, 400);
  }

  const target = await resolveShareUrl(mapsUrl.trim(), deps.fetchImpl);
  if (target.source === "apple") {
    // Apple Maps has no server-side Places API. A share URL still gives us
    // enough data to create a durable POI when it contains coordinates; an
    // already stored Apple reference remains authoritative.
    if (target.placeId) {
      const stored = await d1GetPOI(env.POI_DB, target.placeId);
      if (stored) return json(stored);
    }
    if (!target.coords) {
      return json(
        { error: "unresolvable", message: "Apple Maps URL needs a place id and coordinates" },
        422,
      );
    }
    const placeId =
      target.placeId ??
      stableApplePlaceId(`${target.coords.lat},${target.coords.lng}:${target.query ?? "place"}`);
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
      photo_refs: [],
      fetched_at: new Date().toISOString(),
    };
    await d1UpsertPOI(env.POI_DB, poi);
    return json(poi);
  }
  if (target.placeId) return await getPOI(target.placeId, env, deps);

  if (target.query) {
    const source: POISource = target.source ?? "google";
    const provider = getUpstreamProvider(source, env, deps);
    if (!provider) {
      return json({ error: "unresolvable", message: `no upstream provider for ${source}` }, 422);
    }

    let results: unknown[];
    try {
      results = await provider.textSearch(target.query, {
        lat: target.coords?.lat,
        lng: target.coords?.lng,
      });
    } catch (e) {
      return upstreamError(e);
    }
    const first = results[0];
    if (!first) return json({ error: "not_found", message: "no place matched" }, 404);
    let poi: POI;
    try {
      poi = provider.toPOI(first); // rejects places missing `location`
    } catch (e) {
      return json({ error: "invalid_upstream", message: String(e) }, 502);
    }
    try {
      await Promise.all([kvPutRaw(env.POI_KV, poi.place_id, first), d1UpsertPOI(env.POI_DB, poi)]);
    } catch (e) {
      console.error("cache write failed", e);
    }
    return json(poi);
  }
  return json(
    { error: "unresolvable", message: "no place_id, query, or coordinates in URL" },
    422,
  );
}

// --- GET /poi/search ---

function inLatRange(lat: number): boolean {
  return lat >= -90 && lat <= 90;
}

function inLngRange(lng: number): boolean {
  return lng >= -180 && lng <= 180;
}

function parseQueryNumber(value: string | null): number {
  return value === null || value.trim() === "" ? NaN : Number(value);
}

async function searchPOIs(request: Request, env: Env, _deps: Deps): Promise<Response> {
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
      );
    }
  }
  const hasCoords = latProvided && lngProvided;
  if (q === "" && !hasCoords) {
    return json({ error: "invalid_request", message: "q or lat+lng required" }, 400);
  }
  if (!Number.isFinite(r) || r <= 0) {
    return json({ error: "invalid_request", message: "r must be a positive number (km)" }, 400);
  }
  if (r > MAX_SEARCH_RADIUS_KM) {
    return json(
      { error: "invalid_request", message: `r must be ≤ ${MAX_SEARCH_RADIUS_KM} km` },
      400,
    );
  }

  const hits: POISearchHit[] = await d1SearchPOIs(env.POI_DB, {
    q: q || undefined,
    lat: hasCoords ? lat : undefined,
    lng: hasCoords ? lng : undefined,
    radiusKm: r,
  });
  return json({ results: hits });
}

// --- GET /poi/search/external ---

/** Live Google search for the creation/search entry point. Results are saved
 * before returning so the next local search can reuse them. */
async function searchExternalPOIs(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const lat = Number.parseFloat(url.searchParams.get("lat") ?? "");
  const lng = Number.parseFloat(url.searchParams.get("lng") ?? "");
  const r = url.searchParams.has("r")
    ? Number.parseFloat(url.searchParams.get("r") ?? "")
    : DEFAULT_SEARCH_RADIUS_KM;

  const latProvided = url.searchParams.has("lat");
  const lngProvided = url.searchParams.has("lng");
  if (latProvided || lngProvided) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLatRange(lat) || !inLngRange(lng)) {
      return json(
        { error: "invalid_request", message: "lat/lng must be finite numbers in [-90,90] / [-180,180]" },
        400,
      );
    }
  }
  if (q === "") return json({ error: "invalid_request", message: "q is required" }, 400);
  if (!Number.isFinite(r) || r <= 0 || r > MAX_SEARCH_RADIUS_KM) {
    return json(
      { error: "invalid_request", message: `r must be between 0 and ${MAX_SEARCH_RADIUS_KM} km` },
      400,
    );
  }

  // Live-search query cache (BRAWUKA-283 P2-2): a TTL hit returns the POI
  // list already persisted during the first search — no billed upstream call.
  const queryKey = searchQueryKey(q, latProvided ? lat : undefined, lngProvided ? lng : undefined, r);
  const cached = await kvGetSearchQuery(env.POI_KV, queryKey);
  if (cached) return json({ results: cached });

  const provider = getUpstreamProvider("google", env, deps);
  if (!provider) {
    return json({ error: "upstream_error", message: "google provider not available" }, 502);
  }

  let places: unknown[];
  try {
    places = await provider.textSearch(
      q,
      { lat: latProvided ? lat : undefined, lng: lngProvided ? lng : undefined, radiusKm: r },
    );
  } catch (e) {
    return upstreamError(e);
  }

  const results: Array<{ poi: POI; raw: unknown }> = [];
  for (const place of places.slice(0, SEARCH_RESULT_LIMIT)) {
    try {
      const poi = provider.toPOI(place);
      if (!provider.matchesCategory(poi.types)) {
        poi.not_persisted_reason = "non_food_category";
      }
      results.push({ poi, raw: place });
    } catch {
      // A result without coordinates cannot be created as a cafe.
    }
  }
  const toPersist = results.filter(({ poi }) => !poi.not_persisted_reason);
  const pois = results.map(({ poi }) => poi);
  try {
    if (toPersist.length > 0) {
      await d1UpsertPOIs(env.POI_DB, toPersist.map(({ poi }) => poi));
      await Promise.all(toPersist.map(({ poi, raw }) => kvPutRaw(env.POI_KV, poi.place_id, raw)));
    }
    // Cache what was served (BRAWUKA-283 P2-2), not what was persisted: an
    // all-non-food (or empty) upstream hit is still billable, and repeating
    // it must not call Google again.
    await kvPutSearchQuery(env.POI_KV, queryKey, pois);
  } catch (e) {
    console.error("external search cache write failed", e);
  }
  return json({ results: pois });
}

// --- POST /poi/external ---

interface InvalidEntry {
  index: number;
  reason: string;
}

const MAX_EXTERNAL_STRING_LENGTH = 1000;

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function validateExternalEntry(value: unknown, index: number): POI | InvalidEntry {
  const bad = (reason: string): InvalidEntry => ({ index, reason });
  if (!value || typeof value !== "object") return bad("entry is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.place_id !== "string" || v.place_id === "") return bad("place_id required");
  // Opaque provider ids (e.g. Apple MapKit) can be long; 1024 bounds storage
  // without truncating legitimate references.
  if (v.place_id.length > 1024) return bad("place_id too long (max 1024)");
  if (v.source !== "google" && v.source !== "apple") return bad("source must be google|apple");
  if (typeof v.name !== "string" || v.name === "") return bad("name required");
  if (v.name.length > 200) return bad("name too long (max 200)");
  if (typeof v.lat !== "number" || !Number.isFinite(v.lat) || !inLatRange(v.lat)) {
    return bad("lat must be a finite number in [-90, 90]");
  }
  if (typeof v.lng !== "number" || !Number.isFinite(v.lng) || !inLngRange(v.lng)) {
    return bad("lng must be a finite number in [-180, 180]");
  }
  if (v.address !== undefined && v.address !== null && typeof v.address !== "string") {
    return bad("address must be a string");
  }
  if (typeof v.address === "string" && v.address.length > MAX_EXTERNAL_STRING_LENGTH) {
    return bad(`address too long (max ${MAX_EXTERNAL_STRING_LENGTH})`);
  }
  const types = stringArray(v.types);
  if (types === null) return bad("types must be an array of strings");
  if (v.business_status !== undefined && v.business_status !== null && typeof v.business_status !== "string") {
    return bad("business_status must be a string");
  }
  if (v.hours_json !== undefined && v.hours_json !== null && typeof v.hours_json !== "string") {
    return bad("hours_json must be a string");
  }
  if (typeof v.hours_json === "string" && v.hours_json.length > MAX_EXTERNAL_STRING_LENGTH) {
    return bad(`hours_json too long (max ${MAX_EXTERNAL_STRING_LENGTH})`);
  }
  // Must be parseable JSON — a malformed string would poison the stored row
  // and throw in downstream consumers (issue #39).
  if (typeof v.hours_json === "string") {
    try {
      JSON.parse(v.hours_json);
    } catch {
      return bad("hours_json must be valid JSON");
    }
  }
  const photoRefs = stringArray(v.photo_refs);
  if (photoRefs === null) return bad("photo_refs must be an array of strings");
  return {
    place_id: v.place_id,
    source: v.source,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    address: typeof v.address === "string" ? v.address : null,
    types,
    business_status: typeof v.business_status === "string" ? v.business_status : null,
    hours_json: typeof v.hours_json === "string" ? v.hours_json : null,
    photo_refs: photoRefs,
    fetched_at: new Date().toISOString(),
  };
}

async function storeExternal(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);
  const entries: unknown = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "pois" in body
      ? (body as Record<string, unknown>).pois
      : undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    return json({ error: "invalid_request", message: "pois array required" }, 400);
  }
  if (entries.length > MAX_EXTERNAL_BATCH_SIZE) {
    return json(
      { error: "invalid_request", message: `at most ${MAX_EXTERNAL_BATCH_SIZE} entries per request` },
      400,
    );
  }

  const validated = entries.map(validateExternalEntry);
  const invalid = validated.filter((v): v is InvalidEntry => "reason" in v);
  if (invalid.length > 0) {
    return json({ error: "invalid_request", message: "invalid entries", entries: invalid }, 400);
  }

  // BRAWUKA-328 — DG144/DG52 category gate for this path: source-aware
  // `matchesFoodCategory` (Google `isGoogleFoodOrCafePOI` semantics, Apple
  // MapKit category map; `getUpstreamProvider("apple")` is null by design so
  // the Apple arm cannot go through `provider.matchesCategory`). Skipped
  // entries never touch D1/KV and are reported with a reason instead of
  // failing the whole batch (creation-sheet selects one POI at a time, and
  // a 400 would look like a broken search).
  const pois = validated as POI[];
  const skipped: InvalidEntry[] = [];
  const toPersist = pois.filter((poi, i) => {
    if (matchesFoodCategory(poi.source, poi.types)) return true;
    skipped.push({ index: i, reason: "non_food_category" });
    return false;
  });
  // Atomic batch: one round-trip, all-or-nothing (no partial writes on failure).
  // Then invalidate the KV hot cache for every written id: getPOI serves KV
  // hits without consulting D1, so a stale raw entry (up to CACHE_TTL_SECONDS
  // old) would otherwise shadow the fresh D1 row (BRAWUKA-283 P2-1). A
  // delete storm races the cache-write path, not the read path — a lost
  // delete would only resurrect a stale entry, never serve a write that
  // never happened — so a best-effort post-write delete is the safe order.
  await d1UpsertPOIs(env.POI_DB, toPersist);
  await Promise.all(toPersist.map((poi) => kvDeleteRaw(env.POI_KV, poi.place_id)));
  return json({ stored: toPersist.length, skipped });
}

// --- POST /poi/reverse ---

async function reverseGeocodePOI(request: Request, env: Env, deps: Deps): Promise<Response> {
  let lat: number;
  let lng: number;

  if (request.method === "GET") {
    const url = new URL(request.url);
    lat = Number.parseFloat(url.searchParams.get("lat") ?? "");
    lng = Number.parseFloat(url.searchParams.get("lng") ?? "");
  } else {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "invalid_request", message: "request body must be a JSON object" }, 400);
    }
    const record = body as Record<string, unknown>;
    lat = typeof record.lat === "number" ? record.lat : Number.parseFloat(String(record.lat ?? ""));
    lng = typeof record.lng === "number" ? record.lng : Number.parseFloat(String(record.lng ?? ""));
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLatRange(lat) || !inLngRange(lng)) {
    return json(
      { error: "invalid_request", message: "lat/lng must be finite numbers in [-90,90] / [-180,180]" },
      400,
    );
  }

  const provider = getUpstreamProvider("google", env, deps);
  if (!provider || !provider.reverseGeocode) {
    return json({ error: "upstream_error", message: "google provider not available" }, 502);
  }

  let poi: POI | null;
  try {
    poi = await provider.reverseGeocode({ lat, lng });
  } catch (e) {
    return upstreamError(e);
  }

  if (poi) {
    try {
      await d1UpsertPOI(env.POI_DB, poi);
      // Invalidate KV hot cache (BRAWUKA-332): getPOI serves KV hits without
      // consulting D1, so a stale raw entry would shadow the fresh D1 row.
      await kvDeleteRaw(env.POI_KV, poi.place_id);
    } catch (e) {
      console.error("cache write failed in reverseGeocodePOI:", e);
    }
  }

  return json({ poi });
}

// --- router ---

const ROUTE_RE = /^\/poi\/([^/]+)$/;

export async function handleFetch(
  request: Request,
  env: Env,
  deps: Deps = { fetchImpl: fetch },
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && (path === "/" || path === "/health")) {
      return json({ ok: true, service: "poi-service" });
    }

    if (!(await authorized(request, env))) {
      return unauthorized();
    }

    if (request.method === "GET" && path === "/poi/search/external") {
      return await searchExternalPOIs(request, env, deps);
    }
    if (request.method === "GET" && path === "/poi/search") return await searchPOIs(request, env, deps);
    if (request.method === "POST" && path === "/poi/resolve") return await resolvePOI(request, env, deps);
    if (request.method === "POST" && path === "/poi/external") return await storeExternal(request, env);
    if ((request.method === "POST" || request.method === "GET") && path === "/poi/reverse") {
      return await reverseGeocodePOI(request, env, deps);
    }

    const m = path.match(ROUTE_RE);
    if (request.method === "GET" && m) {
      // Path segments arrive percent-encoded; decode before lookup. Google
      // hex ids contain ':' which standard clients encode as %3A.
      let placeId: string;
      try {
        placeId = decodeURIComponent(m[1]);
      } catch {
        return json({ error: "invalid_request", message: "malformed place_id encoding" }, 400);
      }
      if (placeId === "") return json({ error: "not_found" }, 404);
      return await getPOI(placeId, env, deps);
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("poi-service error:", e);
    return internalError();
  }
}
