/**
 * CafeMood tiles service — request router (BRAWUKA-313).
 *
 * Serves the self-hosted basemap URL space over the per-env R2 bucket, in
 * the SAME shape as the OpenFreeMap public instance (BRAWUKA-311 switches
 * hosting by changing four URLs, never code):
 *
 *   GET /planet                       TileJSON (live version, edge-cached)
 *   GET /planet/{z}/{x}/{y}.pbf       tile BYTES range-read from the archive
 *   GET /planet/{version}/{z}/{x}/{y}.pbf  pinned-version tile bytes
 *   GET /styles/<name>.json           rewritten style (R2 object, passthrough)
 *   GET /fonts/... /sprites/... /natural_earth/...  immutable assets (bytes)
 *   GET /health                       {"ok":true} (no bucket touch)
 *
 * Tiles are range-read out of the ONE versioned archive per build
 * (`planet/{version}/planet.pmtiles`, immutable) via the `pmtiles` library
 * — the official Protomaps Cloudflare pattern. R2 egress is $0 and
 * Worker-bound range reads bill Class B operations, not bandwidth, so
 * serving bytes (not redirecting) is the correct cost shape. Small static
 * assets (styles/fonts/sprites/raster) are served as object bytes; only
 * TileJSON/style rewrites touch JSON. Zoom is clamped to the archive
 * header; anything else is a 404, never a bucket read.
 */

import { TileType, tileTypeExt } from "pmtiles";
import { ArchiveNotFoundError, openArchive } from "./archive";
import { rewriteStyle, routeTile } from "./tilejson";
import type { Env } from "./types";

const STYLE_RE = /^\/styles\/([a-z]+)\.json$/;
const ASSET_RE = /^\/(fonts|natural_earth|sprites)\//;
const VERSION_RE = /^[0-9]{8}_[0-9]{6}_pt$/;

interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

function edgeCache(): EdgeCache | null {
  if (!("caches" in globalThis)) return null;
  const cachesProp = (globalThis as unknown as Record<string, unknown>).caches;
  if (!cachesProp || typeof cachesProp !== "object" || !("default" in cachesProp)) return null;
  return (cachesProp as Record<string, EdgeCache>).default ?? null;
}

export function allowedOrigin(request: Request, env: Env): string {
  if (!env.ALLOWED_ORIGINS) return "";
  const requestOrigin = request.headers.get("Origin") ?? "";
  if (requestOrigin === "") return "";
  for (const candidate of env.ALLOWED_ORIGINS.split(",")) {
    if (candidate.trim() === requestOrigin) return requestOrigin;
  }
  return "";
}

function json(data: unknown, status = 200, cacheControl?: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return new Response(JSON.stringify(data), { status, headers });
}

function notFound(code: string): Response {
  return json({ error: code }, 404);
}

function corsHeaders(request: Request, env: Env, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const origin = allowedOrigin(request, env);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return headers;
}

export async function handleFetch(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method.toUpperCase() === "POST") {
    return new Response(undefined, { status: 405 });
  }
  if (path === "/health") {
    return json({ ok: true });
  }

  // Edge cache (Cloudflare `caches.default`, absent in tests/Node): skip
  // when unavailable — correctness never depends on it. The cached entry
  // stores the payload headers only; CORS is re-derived per request below,
  // so one origin's `Access-Control-Allow-Origin` is never replayed to
  // another. Only 200s are cached — the Cache API rejects 204s.
  const cache = edgeCache();
  if (cache) {
    const cached = await cache.match(request.url);
    if (cached) {
      const headers = corsHeaders(request, env);
      for (const [key, value] of cached.headers) {
        if (key.toLowerCase() === "access-control-allow-origin") continue;
        if (key.toLowerCase() === "vary") continue;
        headers.set(key, value);
      }
      return new Response(cached.body, { headers, status: cached.status });
    }
  }

  const respond = (body: BodyInit | null, status: number, headers: Headers): Response => {
    const cacheControl = env.CACHE_CONTROL ?? "public, max-age=86400";
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", cacheControl);
    for (const [key, value] of corsHeaders(request, env)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    const response = new Response(body, { headers, status });
    if (status === 200) {
      ctx?.waitUntil(cache?.put(request.url, response.clone()) ?? Promise.resolve());
    }
    return response;
  };

  const route = routeTile(path);
  if (route.kind === "tilejson") {
    try {
      const archive = openArchive(env);
      const tileJson = (await archive.getTileJson(
        `${url.protocol}//${url.host}/planet/${env.PLANET_VERSION}`,
      )) as Record<string, unknown>;
      tileJson.tiles = [`${url.protocol}//${url.host}/planet/${env.PLANET_VERSION}/{z}/{x}/{y}.pbf`];
      return respond(JSON.stringify(tileJson), 200, new Headers({ "content-type": "application/json" }));
    } catch (e) {
      if (e instanceof ArchiveNotFoundError) return notFound("unknown_version");
      throw e;
    }
  }
  if (route.kind === "tile" || route.kind === "versioned-tile") {
    const version = route.kind === "versioned-tile" ? route.version : env.PLANET_VERSION;
    if (!VERSION_RE.test(version)) return notFound("unknown_version");
    try {
      const archive = openArchive(env, version);
      const header = await archive.getHeader();
      if (route.z > header.maxZoom || route.z < header.minZoom) {
        return notFound("zoom_out_of_range");
      }
      if (header.tileType !== TileType.Mvt && tileTypeExt(header.tileType) !== "") {
        return notFound("unsupported_tile_type");
      }
      const tile = await archive.getZxy(route.z, route.x, route.y);
      if (!tile) return respond(null, 204, new Headers());
      return respond(
        tile.data,
        200,
        new Headers({ "content-type": "application/x-protobuf" }),
      );
    } catch (e) {
      if (e instanceof ArchiveNotFoundError) return notFound("unknown_version");
      throw e;
    }
  }

  const style = STYLE_RE.exec(path);
  if (style) {
    const obj = await env.TILES_BUCKET.get(`styles/${style[1]}.json`);
    if (!obj?.body) return notFound("unknown_style");
    const text = await new Response(obj.body).text();
    const origin = `${url.protocol}//${url.host}`;
    const rewritten = rewriteStyle(text, origin) ?? text;
    return respond(rewritten, 200, new Headers({ "content-type": "application/json" }));
  }

  if (ASSET_RE.test(path)) {
    const key = decodeURIComponent(path.replace(/^\//, ""));
    const obj = await env.TILES_BUCKET.get(key);
    if (!obj?.body) return notFound("unknown_asset");
    const contentType = key.endsWith(".json")
      ? "application/json"
      : key.endsWith(".png")
        ? "image/png"
        : "application/x-protobuf";
    const headers = new Headers({
      "content-type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    obj.writeHttpMetadata(headers);
    return respond(obj.body, 200, headers);
  }

  return notFound("not_found");
}
