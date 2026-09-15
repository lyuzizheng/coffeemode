/**
 * CafeMood tiles service — request router (BRAWUKA-313).
 *
 * Serves the self-hosted basemap URL space over the per-env R2 bucket, in
 * the SAME shape as the OpenFreeMap public instance (BRAWUKA-311 switches
 * hosting by changing four URLs, never code):
 *
 *   GET /planet                       TileJSON (live version, edge-cached)
 *   GET /planet/{z}/{x}/{y}.pbf       302 → versioned PBF URL (live version)
 *   GET /planet/{version}/{z}/{x}/{y}.pbf  302 → versioned PBF URL (pinned)
 *   GET /styles/<name>.json           rewritten style (R2 object, passthrough)
 *   GET /fonts/...  /sprites/...      immutable assets (R2 redirect)
 *   GET /health                       {"ok":true} (no bucket touch)
 *
 * Tiles redirect instead of proxying (Worker never pays for tile bytes);
 * the redirect target carries the archive ETag as `?v=` so CDN edge caches
 * key per planet version. Zoom is clamped to 0–14 (TileJSON maxzoom);
 * anything else is a 404, never a bucket read.
 */

import { publicOrigin, rewriteStyle, routeTile, tilesJson } from "./tilejson";
import type { Env } from "./types";
const MAX_ZOOM = 14;
const STYLE_RE = /^\/styles\/([a-z]+)\.json$/;
const ASSET_RE = /^\/(fonts|natural_earth|sprites)\//;

function json(data: unknown, status = 200, cacheControl?: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return new Response(JSON.stringify(data), { status, headers });
}

function notFound(code: string): Response {
  return json({ error: code }, 404);
}

function tileRedirect(origin: string, version: string, z: number, x: number, y: number, etag: string | null): Response {
  const url = new URL(`${origin}/planet/${version}/${z}/${x}/${y}.pbf`);
  if (etag) url.searchParams.set("v", etag.replace(/"/g, ""));
  const headers = new Headers({
    location: url.toString(),
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  });
  return new Response(null, { status: 302, headers });
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = publicOrigin(request, env);

  if (path === "/health") {
    return json({ ok: true });
  }

  const route = routeTile(path);
  if (route.kind === "tilejson") {
    return json(tilesJson(origin, env.PLANET_VERSION), 200, "public, max-age=86400");
  }
  if (route.kind === "tile" || route.kind === "versioned-tile") {
    const version = route.version ?? env.PLANET_VERSION;
    const z = route.z ?? 0;
    if (z < 0 || z > MAX_ZOOM) return notFound("zoom_out_of_range");
    const head = await env.TILES_BUCKET.head(`planet/${version}/planet.pmtiles`);
    if (!head) return notFound("unknown_version");
    return tileRedirect(origin, version, z, route.x ?? 0, route.y ?? 0, head.etag);
  }

  const style = STYLE_RE.exec(path);
  if (style) {
    const obj = await env.TILES_BUCKET.get(`styles/${style[1]}.json`);
    if (!obj || !obj.body) return notFound("unknown_style");
    const text = await new Response(obj.body).text();
    const rewritten = rewriteStyle(text, origin) ?? text;
    const headers = new Headers({
      "content-type": "application/json",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    return new Response(rewritten, { headers });
  }

  if (ASSET_RE.test(path)) {
    const key = path.replace(/^\//, "");
    const head = await env.TILES_BUCKET.head(key);
    if (!head) return notFound("unknown_asset");
    const headers = new Headers({
      location: `${origin}/${key}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    });
    return new Response(null, { status: 302, headers });
  }

  return notFound("not_found");
}
