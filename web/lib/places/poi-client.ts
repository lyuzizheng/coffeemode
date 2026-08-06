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
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    // Never let Next.js cache proxy responses — the worker owns caching.
    cache: "no-store",
    headers: {
      "x-poi-service-token": config.token,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new POIServiceError(
      `POI service responded ${res.status}: ${body.slice(0, 200)}`,
      res.status === 401 ? 502 : res.status,
      res.status,
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
  const data = await poiFetch(`/poi/${encodeURIComponent(placeId)}`, {
    method: "GET",
  });
  return data as POI;
}