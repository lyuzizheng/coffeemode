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

import type { POI, POISearchResponse } from "@/types/places";

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

export interface POIConfig {
  baseUrl: string;
  token: string;
}

export function getPOIConfig(env: Record<string, string | undefined> = process.env): POIConfig | null {
  const url = env.POI_SERVICE_URL;
  const token = env.POI_SERVICE_TOKEN;
  if (!url || !token) return null;
  return { baseUrl: url.replace(/\/+$/, ""), token };
}

/** Encode a URI path segment while keeping the characters that are valid inside
 *  a segment (including `:` and `+`) unencoded. This prevents double-encoding
 *  Google `0x...:0x...` place IDs. */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /%(?:3[Aa]|40|21|24|26|27|28|29|2[Aa]|2[Bb]|2[Cc]|3[Bb]|3[Dd])/g,
    (match) => decodeURIComponent(match),
  );
}

async function poiFetch(
  path: string,
  init: RequestInit,
  config: POIConfig | null = getPOIConfig(),
): Promise<unknown> {
  if (!config) {
    throw new POIServiceError(
      "POI service is not configured (POI_SERVICE_URL / POI_SERVICE_TOKEN)",
      503,
    );
  }

  // Build a plain-object header map so callers can pass either a plain object
  // or a Headers instance without losing the auth token.
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("x-poi-service-token", config.token);
  const headers = Object.fromEntries(requestHeaders.entries());

  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    // Never let Next.js cache proxy responses — the worker owns caching.
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(5000),
    headers,
  });
  if (!res.ok) {
    const upstreamStatus = res.status;
    const body = await res.text().catch(() => "");
    console.error("POI service error", { status: upstreamStatus, body: body.slice(0, 1000) });
    let message = "POI service returned an error";
    if (upstreamStatus === 401) message = "POI service unavailable";
    else if (upstreamStatus === 404) message = "POI not found";
    else if (upstreamStatus === 422) message = "POI could not be resolved";
    else if (upstreamStatus >= 500) message = "POI service unavailable";
    else if (upstreamStatus >= 400) message = "Invalid POI request";
    throw new POIServiceError(
      message,
      upstreamStatus === 401 ? 502 : upstreamStatus,
      upstreamStatus,
    );
  }
  return res.json();
}

/** GET /poi/search — stored-POI name match + haversine distance sort. */
export async function searchPOIs(params: {
  q?: string;
  lat?: number;
  lng?: number;
  r?: number;
}): Promise<POISearchResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.lat !== undefined) sp.set("lat", String(params.lat));
  if (params.lng !== undefined) sp.set("lng", String(params.lng));
  if (params.r !== undefined) sp.set("r", String(params.r));
  const query = sp.toString();

  const data = await poiFetch(`/poi/search${query ? `?${query}` : ""}`, {
    method: "GET",
  });
  return data as POISearchResponse;
}

/** POST /poi/resolve — Google Maps share URL → POI (cafe creation import). */
export async function resolveMapsUrl(mapsShareUrl: string): Promise<POI> {
  const data = await poiFetch("/poi/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maps_share_url: mapsShareUrl }),
  });
  return data as POI;
}

/** GET /poi/:place_id — fetch/enrich one POI. */
export async function getPOI(placeId: string): Promise<POI> {
  const data = await poiFetch(`/poi/${encodePathSegment(placeId)}`, {
    method: "GET",
  });
  return data as POI;
}
