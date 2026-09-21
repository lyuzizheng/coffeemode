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

import type { POI, POISearchResponse } from "@shared/places/types";

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
    logError({ route: "poi-service", error, requestId: resolvedId });
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
    logError({ route: "poi-service", error: { status: upstreamStatus, message }, requestId: resolvedId });
    throw new POIServiceError(
      message,
      upstreamStatus === 401 ? 502 : upstreamStatus,
      upstreamStatus,
    );
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

/** GET /poi/search/external — live Google Places search, cached by the worker. */
export async function searchExternalPOIs(
  params: {
    q: string;
    lat?: number;
    lng?: number;
    r?: number;
  },
  requestId?: string,
): Promise<POISearchResponse> {
  const query = searchParams(params);
  const data = await poiFetch(`/poi/search/external?${query}`, { method: "GET" }, undefined, requestId);
  return data as POISearchResponse;
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
