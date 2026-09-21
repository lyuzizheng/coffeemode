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
import { logError, logWarn } from "../../web/shared/log";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_EXTERNAL_BATCH_SIZE,
  MAX_SEARCH_RADIUS_KM,
  SEARCH_RESULT_LIMIT,
} from "./constants";
import {
  getUpstreamProvider,
  isGooglePlaceId,
  matchesFoodCategory,
  resolveUpstreamSource,
  UpstreamApiError,
} from "./upstream";
import type { Deps, Env, POI, POISearchHit, POISource } from "./types";
import { stableApplePlaceId } from "../../web/shared/places/apple-place-id";
import {
  computeExpiresAt,
  d1GetPOI,
  d1SearchPOIs,
  d1UpsertPOI,
  d1UpsertPOIs,
  isFresh,
  kvDeletePOI,
  kvGetPOI,
  kvGetSearchQuery,
  kvPutPOI,
  kvPutSearchQuery,
  searchQueryKey,
} from "./store";
import { resolveShareUrl } from "./url";

// Re-exported for consumers/tests that historically imported from handlers.
export { authorized } from "./auth";


function upstreamError(request: Request, e: unknown): Response {
  if (e instanceof UpstreamApiError) {
    // P0 scrub: the upstream `message` can carry the request URL (embeds
    // `key=`) or echoed body text — never relay it. True parse/validation
    // failures (bad input shape, unparseable candidate) are
    // `invalid_upstream`; quota exhaustion (429), key denial (403), and
    // other dependency failures stay `upstream_error` so the D8
    // `upstream_error` spike alert sees them.
    if (e.status === 400 || e.status === 404) {
      return json({ error: "invalid_upstream" }, 502, request);
    }
    return json({ error: "upstream_error" }, 502, request);
  }
  return json({ error: "upstream_error" }, 502, request);
}

// Apple Maps has no server-side Places API: a share URL with coordinates but
// no stored reference falls back to the shared `stableApplePlaceId` hash.

// --- GET /poi/:place_id ---

async function getPOI(placeId: string, env: Env, deps: Deps, request: Request): Promise<Response> {
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

  // 4. Upstream API → backfill both
  let rawPlace: unknown;
  try {
    rawPlace = await provider.getDetails(placeId);
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
  try {
    await Promise.all([kvPutPOI(env.POI_KV, poi), d1UpsertPOI(env.POI_DB, poi)]);
  } catch (e) {
    logError({ route: "GET /poi/:place_id", request, error: e, status: 200 });
  }
  return json(poi, request);
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

    let results: unknown[];
    try {
      results = await provider.textSearch(target.query, {
        lat: target.coords?.lat,
        lng: target.coords?.lng,
      });
    } catch (e) {
      return upstreamError(request, e);
    }
    const first = results[0];
    if (!first) return json({ error: "not_found", message: "no place matched" }, 404, request);
    let poi: POI;
    try {
      poi = provider.toPOI(first); // rejects places missing `location`
    } catch {
      // P0 scrub: same as above — canned code only.
      return json({ error: "invalid_upstream" }, 502, request);
    }
    try {
      await Promise.all([kvPutPOI(env.POI_KV, poi), d1UpsertPOI(env.POI_DB, poi)]);
    } catch (e) {
      logError({ route: "POST /poi/resolve", request, error: e, status: 200 });
    }
    return json(poi, request);
  }
  return json(
    { error: "unresolvable", message: "no place_id, query, or coordinates in URL" },
    422,
    request,
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
        request,
      );
    }
  }
  if (q === "") return json({ error: "invalid_request", message: "q is required" }, 400, request);
  if (!Number.isFinite(r) || r <= 0 || r > MAX_SEARCH_RADIUS_KM) {
    return json(
      { error: "invalid_request", message: `r must be between 0 and ${MAX_SEARCH_RADIUS_KM} km` },
      400,
      request,
    );
  }

  // Live-search query cache (BRAWUKA-283 P2-2): a TTL hit returns the POI
  // list already persisted during the first search — no billed upstream call.
  const queryKey = searchQueryKey(q, latProvided ? lat : undefined, lngProvided ? lng : undefined, r);
  const cached = await kvGetSearchQuery(env.POI_KV, queryKey);
  if (cached) return json({ results: cached }, request);

  const provider = getUpstreamProvider("google", env, deps);
  if (!provider) {
    return json({ error: "upstream_error", message: "google provider not available" }, 502, request);
  }

  let places: unknown[];
  try {
    places = await provider.textSearch(
      q,
      { lat: latProvided ? lat : undefined, lng: lngProvided ? lng : undefined, radiusKm: r },
    );
  } catch (e) {
    return upstreamError(request, e);
  }

  const results: POI[] = [];
  for (const place of places.slice(0, SEARCH_RESULT_LIMIT)) {
    try {
      const poi = provider.toPOI(place);
      if (!provider.matchesCategory(poi.types)) {
        poi.not_persisted_reason = "non_food_category";
      }
      results.push(poi);
    } catch {
      // A result without coordinates cannot be created as a cafe.
    }
  }
  const toPersist = results.filter((poi) => !poi.not_persisted_reason);
  try {
    if (toPersist.length > 0) {
      await d1UpsertPOIs(env.POI_DB, toPersist);
      await Promise.all(toPersist.map((poi) => kvPutPOI(env.POI_KV, poi)));
    }
    // Cache what was served (BRAWUKA-283 P2-2), not what was persisted: an
    // all-non-food (or empty) upstream hit is still billable, and repeating
    // it must not call Google again.
    await kvPutSearchQuery(env.POI_KV, queryKey, results);
  } catch (e) {
    logError({ route: "GET /poi/search/external", request, error: e, status: 200 });
  }
  return json({ results }, request);
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
  // BRAWUKA-566: an apple entry must never carry a Google-shaped id. place_id
  // is the D1 primary key and getPOI serves apple rows verbatim, so accepting
  // one here would poison the canonical Google row for that id (apple rows
  // never refresh upstream — the forgery would be permanent).
  if (v.source === "apple" && isGooglePlaceId(v.place_id)) {
    return bad("apple place_id must not use a Google id format");
  }
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
  const now = new Date().toISOString();
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
    fetched_at: now,
    expires_at: computeExpiresAt(now),
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
    return json({ error: "invalid_request", message: "pois array required" }, 400, request);
  }
  if (entries.length > MAX_EXTERNAL_BATCH_SIZE) {
    return json(
      { error: "invalid_request", message: `at most ${MAX_EXTERNAL_BATCH_SIZE} entries per request` },
      400,
      request,
    );
  }

  const validated = entries.map(validateExternalEntry);
  const invalid = validated.filter((v): v is InvalidEntry => "reason" in v);
  if (invalid.length > 0) {
    return json({ error: "invalid_request", message: "invalid entries", entries: invalid }, 400, request);
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
  const candidates: Array<{ poi: POI; index: number }> = [];
  for (const [i, poi] of pois.entries()) {
    if (matchesFoodCategory(poi.source, poi.types)) {
      candidates.push({ poi, index: i });
    } else {
      skipped.push({ index: i, reason: "non_food_category" });
    }
  }
  // BRAWUKA-566: never let one source overwrite the other's row. place_id is
  // the D1 primary key, so an apple entry reusing a google id would replace
  // the real row and getPOI would serve the forgery forever (apple rows never
  // refresh upstream). Conflicts skip per-entry like the category gate above;
  // same-source upserts still replace normally.
  const storedRows = await Promise.all(
    candidates.map(({ poi }) => d1GetPOI(env.POI_DB, poi.place_id)),
  );
  const toPersist: POI[] = [];
  candidates.forEach(({ poi, index }, j) => {
    const stored = storedRows[j];
    if (stored && stored.source !== poi.source) {
      skipped.push({ index, reason: "source_conflict" });
      return;
    }
    toPersist.push(poi);
  });
  // Atomic batch: one round-trip, all-or-nothing (no partial writes on failure).
  // Then invalidate the KV hot cache for every written id: getPOI serves KV
  // hits without consulting D1, so a stale raw entry (up to CACHE_TTL_SECONDS
  // old) would otherwise shadow the fresh D1 row (BRAWUKA-283 P2-1). A
  // delete storm races the cache-write path, not the read path — a lost
  // delete would only resurrect a stale entry, never serve a write that
  // never happened — so a best-effort post-write delete is the safe order.
  await d1UpsertPOIs(env.POI_DB, toPersist);
  await Promise.all(toPersist.map((poi) => kvDeletePOI(env.POI_KV, poi.place_id)));
  return json({ stored: toPersist.length, skipped }, request);
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
      return json({ error: "invalid_request", message: "request body must be a JSON object" }, 400, request);
    }
    const record = body as Record<string, unknown>;
    lat = typeof record.lat === "number" ? record.lat : Number.parseFloat(String(record.lat ?? ""));
    lng = typeof record.lng === "number" ? record.lng : Number.parseFloat(String(record.lng ?? ""));
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLatRange(lat) || !inLngRange(lng)) {
    return json(
      { error: "invalid_request", message: "lat/lng must be finite numbers in [-90,90] / [-180,180]" },
      400,
      request,
    );
  }

  const provider = getUpstreamProvider("google", env, deps);
  if (!provider || !provider.reverseGeocode) {
    return json({ error: "upstream_error", message: "google provider not available" }, 502, request);
  }

  let poi: POI | null;
  try {
    poi = await provider.reverseGeocode({ lat, lng });
  } catch (e) {
    return upstreamError(request, e);
  }

  if (poi) {
    try {
      await d1UpsertPOI(env.POI_DB, poi);
      // Invalidate KV hot cache (BRAWUKA-332): getPOI serves KV hits without
      // consulting D1, so a stale entry would shadow the fresh D1 row.
      await kvDeletePOI(env.POI_KV, poi.place_id);
    } catch (e) {
      logError({ route: "GET /poi/reverse", request, error: e, status: 200 });
    }
  }

  return json({ poi }, request);
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
      return json({ ok: true, service: "poi-service" }, request);
    }

    if (!(await authorized(request, env))) {
      logWarn({ route: "auth", request, error: "unauthorized", status: 401, code: "unauthorized" });
      return unauthorized(request);
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
        return json({ error: "invalid_request", message: "malformed place_id encoding" }, 400, request);
      }
      if (placeId === "") return json({ error: "not_found" }, 404, request);
      return await getPOI(placeId, env, deps, request);
    }

    return json({ error: "not_found" }, 404, request);
  } catch (e) {
    logError({ route: "poi-service", request, error: e, status: 500, code: "internal_error" });
    return internalError(request);
  }
}
