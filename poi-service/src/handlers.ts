/**
 * HTTP handlers for the four POI endpoints + shared auth.
 * Pure functions over injected Env/Deps — unit-testable without a Worker runtime.
 *
 * Endpoints (all require POI_SERVICE_TOKEN):
 *   GET  /poi/:place_id    KV hot → D1 fresh → Google API → backfill both
 *   POST /poi/resolve      {maps_share_url} → POI (creation import path)
 *   GET  /poi/search       ?q&lat&lng&r — stored POIs, name match + haversine sort
 *   POST /poi/external     store externally-searched POIs (Google live / Apple refs)
 */

import type { Deps, Env, POI, POISearchHit } from "./types";
import { fetchPlaceDetails, textSearch, toPOI, GoogleApiError } from "./google";
import {
  d1GetPOI,
  d1SearchPOIs,
  d1UpsertPOI,
  isFresh,
  kvGetRaw,
  kvPutRaw,
} from "./store";
import { resolveShareUrl } from "./url";

// --- helpers ---

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Constant-time-ish token compare (XOR fold). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const A = new TextEncoder().encode(a);
  const B = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

function bearer(request: Request): string | null {
  return (
    request.headers.get("x-poi-service-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

export async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = bearer(request);
  if (!token || !env.POI_SERVICE_TOKEN) return false;
  return safeEqual(token, env.POI_SERVICE_TOKEN);
}

/** Rough heuristic: Google place ids are ChIJ… or 0x…:0x…; Apple refs are arbitrary. */
export function isGooglePlaceId(placeId: string): boolean {
  return /^(ChIJ|0x)/.test(placeId);
}

function upstreamError(e: unknown): Response {
  if (e instanceof GoogleApiError) {
    return json({ error: "upstream_error", status: e.status, message: e.message }, 502);
  }
  return json({ error: "upstream_error", message: String(e) }, 502);
}

// --- GET /poi/:place_id ---

async function getPOI(placeId: string, env: Env, deps: Deps): Promise<Response> {
  // 1. KV hot cache (raw Google response, ~7d TTL)
  const raw = await kvGetRaw(env.POI_KV, placeId);
  if (raw) {
    try {
      return json(toPOI(JSON.parse(raw)));
    } catch {
      // corrupt cache entry — fall through to D1/Google
    }
  }

  // 2. D1 durable store
  const stored = await d1GetPOI(env.POI_DB, placeId);

  // Apple POIs have no server-side upstream — serve what's stored, else 404.
  const googleId = isGooglePlaceId(placeId);
  if (stored && !googleId) {
    return stored ? json(stored) : json({ error: "not_found" }, 404);
  }

  if (stored && isFresh(stored)) return json(stored);

  // 3. Google API → backfill both
  if (googleId) {
    try {
      const gp = await fetchPlaceDetails(placeId, env, deps.fetchImpl);
      const poi = toPOI(gp);
      await Promise.all([kvPutRaw(env.POI_KV, placeId, gp), d1UpsertPOI(env.POI_DB, poi)]);
      return json(poi);
    } catch (e) {
      // Graceful degradation: serve stale D1 row if we have one.
      if (stored) return json(stored);
      return upstreamError(e);
    }
  }

  return json({ error: "not_found" }, 404);
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
  if (target.placeId) return getPOI(target.placeId, env, deps);

  if (target.query) {
    try {
      const results = await textSearch(
        target.query,
        { lat: target.coords?.lat, lng: target.coords?.lng },
        env,
        deps.fetchImpl,
      );
      const first = results[0];
      if (!first) return json({ error: "not_found", message: "no place matched" }, 404);
      const poi = toPOI(first);
      await Promise.all([kvPutRaw(env.POI_KV, first.id, first), d1UpsertPOI(env.POI_DB, poi)]);
      return json(poi);
    } catch (e) {
      return upstreamError(e);
    }
  }

  return json(
    { error: "unresolvable", message: "no place_id, query, or coordinates in URL" },
    422,
  );
}

// --- GET /poi/search ---

async function searchPOIs(request: Request, env: Env, _deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const lat = Number.parseFloat(url.searchParams.get("lat") ?? "");
  const lng = Number.parseFloat(url.searchParams.get("lng") ?? "");
  const r = url.searchParams.get("r") ? Number.parseFloat(url.searchParams.get("r")!) : 50;

  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
  if (q === "" && !hasCoords) {
    return json({ error: "invalid_request", message: "q or lat+lng required" }, 400);
  }
  if (Number.isNaN(r) || r <= 0) {
    return json({ error: "invalid_request", message: "r must be a positive number (km)" }, 400);
  }

  const hits: POISearchHit[] = await d1SearchPOIs(env.POI_DB, {
    q: q || undefined,
    lat: hasCoords ? lat : undefined,
    lng: hasCoords ? lng : undefined,
    radiusKm: r,
  });
  return json({ results: hits });
}

// --- POST /poi/external ---

interface InvalidEntry {
  index: number;
  reason: string;
}

function validateExternalEntry(value: unknown, index: number): POI | InvalidEntry {
  const bad = (reason: string): InvalidEntry => ({ index, reason });
  if (!value || typeof value !== "object") return bad("entry is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.place_id !== "string" || v.place_id === "") return bad("place_id required");
  if (v.source !== "google" && v.source !== "apple") return bad("source must be google|apple");
  if (typeof v.name !== "string" || v.name === "") return bad("name required");
  if (typeof v.lat !== "number" || !Number.isFinite(v.lat)) return bad("lat required");
  if (typeof v.lng !== "number" || !Number.isFinite(v.lng)) return bad("lng required");
  return {
    place_id: v.place_id,
    source: v.source,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    address: typeof v.address === "string" ? v.address : null,
    types: Array.isArray(v.types) ? (v.types as string[]) : [],
    business_status: typeof v.business_status === "string" ? v.business_status : null,
    hours_json: typeof v.hours_json === "string" ? v.hours_json : null,
    photo_refs: Array.isArray(v.photo_refs) ? (v.photo_refs as string[]) : [],
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

  const validated = entries.map(validateExternalEntry);
  const invalid = validated.filter((v): v is InvalidEntry => "reason" in v);
  if (invalid.length > 0) {
    return json({ error: "invalid_request", message: "invalid entries", entries: invalid }, 400);
  }

  for (const poi of validated as POI[]) {
    await d1UpsertPOI(env.POI_DB, poi);
  }
  return json({ stored: validated.length });
}

// --- router ---

const ROUTE_RE = /^\/poi\/([^/]+)$/;

export async function handleFetch(
  request: Request,
  env: Env,
  deps: Deps = { fetchImpl: fetch },
): Promise<Response> {
  if (!(await authorized(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/poi/search") return searchPOIs(request, env, deps);
  if (request.method === "POST" && path === "/poi/resolve") return resolvePOI(request, env, deps);
  if (request.method === "POST" && path === "/poi/external") return storeExternal(request, env);

  const m = path.match(ROUTE_RE);
  if (request.method === "GET" && m) return getPOI(m[1], env, deps);

  return json({ error: "not_found" }, 404);
}