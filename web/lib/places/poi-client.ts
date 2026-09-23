import { logError } from "@/lib/observability/server-log";
import "server-only";

import { WORKER_TIMEOUT_MS } from "@/lib/http";
import { REQUEST_ID_HEADER } from "@shared/request-id";

/**
 * Server-only client for the POI cache service (Cloudflare Worker).
 *
 * The worker is the ONLY component that talks to Google Places; Next.js
 * route handlers proxy through it. Callers must never pass a Google API key.
 *
 * Env (server-only, never NEXT_PUBLIC):
 *   POI_SERVICE_URL    e.g. https://poi-service.<subdomain>.workers.dev
 *   POI_SERVICE_TOKEN  shared secret the worker authenticates with
 */

import type { AutocompleteResponse, POI, POISearchResponse } from "@shared/places/types";

export class POIServiceError extends Error {
  constructor(
    message: string,
    /** HTTP status to return to the caller. */
    readonly status: number,
    /** Status the upstream worker returned (when it responded). */
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "POIServiceError";
  }
}

/**
 * Verify one provider reference against the POI worker before a cafe write
 * consumes it (BRAWUKA-636: `POST /api/cafes` no longer trusts an unvalidated
 * `place_id` — any signed-in caller could otherwise claim an unverified id
 * and squat the dedupe slot).
 *
 * One `GET /poi/:place_id` covers both sources: Google ids resolve live
 * through the worker (it fans out to Google when nothing stored matches),
 * while Apple has no server-side upstream so only a row persisted through
 * the `POST /poi/external` / resolve boundary verifies. A worker 404 is a
 * genuine invalid id (not an outage) and yields `null`; transport, config,
 * and 5xx failures throw `POIServiceError` so the route's `poi_service`
 * envelope still owns outages (fail-closed: creation never consumes an
 * unverified id). A worker 502 for a forged Google id also rejects the
 * creation — through `poi_service` rather than `invalid_request`, because the
 * worker collapses Google 404s into `invalid_upstream` and the web side
 * cannot tell those apart from real outages.
 */
export async function verifyPlaceReference(
  source: "google" | "apple",
  placeId: string,
  requestId?: string,
): Promise<POI | null> {
  try {
    const poi = await getPOI(placeId, undefined, requestId);
    if (poi.place_id !== placeId || poi.source !== source) return null;
    return poi;
  } catch (err) {
    if (err instanceof POIServiceError && (err.upstreamStatus === 404 || err.status === 404)) return null;
    throw err;
  }
}

interface POIConfig {
  baseUrl: string;
  token: string;
}

export function getPOIConfig(env: Record<string, string | undefined> = process.env): POIConfig | null {
  const url = env.POI_SERVICE_URL;
  const token = env.POI_SERVICE_TOKEN;
  if (!url || !token) return null;
  return { baseUrl: url.replace(/\/+$/, ""), token };
}

async function poiFetch(
  path: string,
  init: RequestInit,
  config: POIConfig | null = getPOIConfig(),
  requestId?: string,
): Promise<unknown> {
  if (!config) {
    throw new POIServiceError(
      "POI service is not configured (POI_SERVICE_URL / POI_SERVICE_TOKEN)",
      503,
    );
  }

  // D7 correlation: apiRoute resolves ctx.requestId at the boundary — pass
  // it straight through so the worker's access/error lines join ours.
  // Non-route callers omit it and get a fresh id (log pair shares it,
  // worker-only correlation still works). Takes the id string, never the
  // Request: a second getRequestId(inbound) here would mint a different
  // UUID when the header is absent and silently break the D7 join.
  const resolvedId = requestId ?? crypto.randomUUID();
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("x-poi-service-token", config.token);
  requestHeaders.set(REQUEST_ID_HEADER, resolvedId);
  const headers = Object.fromEntries(requestHeaders.entries());

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      // Never let Next.js cache proxy responses — the worker owns caching.
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(WORKER_TIMEOUT_MS),
      headers,
    });
  } catch (error) {
    // Transport failure (DNS, refused, timeout): same typed error as an
    // upstream response so the route boundary emits 502 `poi_service`,
    // never a bare 500 (spec 0011 D5/BRAWUKA-537).
    logError({
      route: "poi-service",
      error,
      requestId: resolvedId,
      status: 502,
      code: "upstream_error",
    });
    throw new POIServiceError("POI service unavailable", 502);
  }
  if (!res.ok) {
    const upstreamStatus = res.status;
    // Cancel the body stream without buffering it. Upstream error bodies may
    // contain internal worker details or be unbounded in size.
    // Benign: best-effort cancel of unread upstream response stream.
    await res.body?.cancel().catch(() => {});
    let message = "POI service returned an error";
    if (upstreamStatus === 401) message = "POI service unavailable";
    else if (upstreamStatus === 404) message = "POI not found";
    else if (upstreamStatus === 422) message = "POI could not be resolved";
    else if (upstreamStatus >= 500) message = "POI service unavailable";
    else if (upstreamStatus >= 400) message = "Invalid POI request";
    const effectiveStatus = upstreamStatus === 401 ? 502 : upstreamStatus;
    // Log the status the caller will actually see, and tag only real outages
    // (spec 0011 D8, BRAWUKA-541): a worker 404/422 is a normal negative
    // answer, not a dependency failure, so it must not feed the
    // `upstream_error` chart or its alert.
    logError({
      route: "poi-service",
      error: { status: upstreamStatus, message },
      requestId: resolvedId,
      status: effectiveStatus,
      ...(effectiveStatus >= 500 ? { code: "upstream_error" as const } : {}),
    });
    throw new POIServiceError(message, effectiveStatus, upstreamStatus);
  }
  return res.json();
}

function searchParams(params: {
  q?: string;
  lat?: number;
  lng?: number;
  r?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.lat !== undefined) sp.set("lat", String(params.lat));
  if (params.lng !== undefined) sp.set("lng", String(params.lng));
  if (params.r !== undefined) sp.set("r", String(params.r));
  return sp.toString();
}

/** GET /poi/search — stored-POI name match + haversine distance sort. */
export async function searchPOIs(
  params: {
    q?: string;
    lat?: number;
    lng?: number;
    r?: number;
  },
  requestId?: string,
): Promise<POISearchResponse> {
  const query = searchParams(params);

  const data = await poiFetch(
    `/poi/search${query ? `?${query}` : ""}`,
    {
      method: "GET",
    },
    undefined,
    requestId,
  );
  return data as POISearchResponse;
}

/** GET /poi/autocomplete — live Google predictions (the typing phase).
 *  `session` is the Autocomplete session token; it must be the same one the
 *  selection's `getPOI` call carries, or the session never terminates and
 *  every keystroke bills per request instead of at $0. */
export async function autocompletePOIs(
  params: {
    q: string;
    session: string;
    lat?: number;
    lng?: number;
    r?: number;
  },
  requestId?: string,
): Promise<AutocompleteResponse> {
  const query = new URLSearchParams(searchParams(params));
  query.set("session", params.session);
  const data = await poiFetch(
    `/poi/autocomplete?${query.toString()}`,
    { method: "GET" },
    undefined,
    requestId,
  );
  return data as AutocompleteResponse;
}

/** POST /poi/external — persist a client-side Apple MapKit result. Non-food
 *  entries are not stored; the worker reports them in `skipped` (BRAWUKA-328). */
export async function storeExternalPOIs(
  pois: POI[],
  requestId?: string,
): Promise<{ stored: number; skipped?: Array<{ index: number; reason: string }> }> {
  const data = await poiFetch(
    "/poi/external",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pois }),
    },
    undefined,
    requestId,
  );
  return data as { stored: number; skipped?: Array<{ index: number; reason: string }> };
}

/** POST /poi/resolve — Google Maps share URL → POI (cafe creation import). */
export async function resolveMapsUrl(mapsShareUrl: string, requestId?: string): Promise<POI> {
  const data = await poiFetch(
    "/poi/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maps_share_url: mapsShareUrl }),
    },
    undefined,
    requestId,
  );
  return data as POI;
}

/** GET /poi/:place_id — fetch/enrich one POI. `session` terminates the
 *  Autocomplete session that produced the id (see `autocompletePOIs`). */
export async function getPOI(
  placeId: string,
  session?: string,
  requestId?: string,
): Promise<POI> {
  // Encode: place ids arrive from the client (`place_id` query param) and
  // may contain reserved characters (`:`, `/`, `%`). The worker matches
  // `[^/]+` and `decodeURIComponent`s the segment, so encoding round-trips.
  const query = session ? `?session=${encodeURIComponent(session)}` : "";
  const data = await poiFetch(
    `/poi/${encodeURIComponent(placeId)}${query}`,
    {
      method: "GET",
    },
    undefined,
    requestId,
  );
  return data as POI;
}
