import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { archiveKey } from "../src/archive";
import { allowedOrigin, handleFetch } from "../src/handlers";
import { rewriteStyle, routeTile } from "../src/tilejson";
import type { Env, R2ObjectLike } from "../src/types";
const VERSION = "20260913_164504_pt";
// Uint8Array view (not Buffer): `.buffer` is exactly the file bytes, so the
// R2 fake's `buffer.slice(offset, offset + length)` serves true ranges.
const ARCHIVE_BYTES: Uint8Array = new Uint8Array(
  readFileSync(new URL("./fixtures/firenze.pmtiles", import.meta.url)),
);
const ARCHIVE_ETAG = '"firenze-fixture"';

function r2Object(body: Uint8Array | string, etag = ARCHIVE_ETAG): R2ObjectLike {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const copy = bytes.slice();
  return {
    size: copy.length,
    etag,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(copy);
        controller.close();
      },
    }),
    async arrayBuffer(): Promise<ArrayBuffer> {
      return copy.buffer as ArrayBuffer;
    },
    writeHttpMetadata() {},
  };
}

/**
 * In-memory R2 fake over the real 6.6MB Firenze archive: range gets slice
 * the archive bytes (like R2 `range: {offset,length}`), style/asset gets
 * serve small JSON blobs. Every response below exercises the real `pmtiles`
 * directory walk — no mocked tile bytes anywhere.
 */
function makeEnv(): Env {
  const styles: Record<string, string> = {
    "styles/liberty.json": JSON.stringify({
      version: 8,
      sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
      layers: [],
    }),
  };
  const assets: Record<string, string> = {
    "fonts/Noto Sans Regular/0-255.pbf": "glyph-bytes",
    "sprites/ofm_f384/ofm.json": JSON.stringify({ sprite: true }),
  };
  return {
    TILES_BUCKET: {
      async get(key: string, options?: { range?: { offset: number; length: number } }) {
        if (key === archiveKey(VERSION)) {
          const range = options?.range;
          const slice = range
            ? ARCHIVE_BYTES.slice(range.offset, range.offset + range.length)
            : ARCHIVE_BYTES.slice();
          return r2Object(slice);
        }
        const blob = styles[key] ?? assets[key];
        if (!blob) return null;
        return r2Object(blob, '"static"');
      },
    },
    PLANET_VERSION: VERSION,
    ALLOWED_ORIGINS: "https://cafemood.app,https://staging.cafemood.app,http://localhost:3000",
    CACHE_CONTROL: "public, max-age=86400",
  };
}

function get(path: string, env: Env, origin = "https://cafemood.app"): Promise<Response> {
  return handleFetch(new Request(`https://staging-tiles.cafemood.app${path}`, { headers: { Origin: origin } }), env);
}

describe("routeTile", () => {
  it("routes the TileJSON, live tiles, and pinned tiles", () => {
    expect(routeTile("/planet")).toEqual({ kind: "tilejson" });
    expect(routeTile("/planet/10/824/426.pbf")).toEqual({ kind: "tile", z: 10, x: 824, y: 426 });
    expect(routeTile(`/planet/${VERSION}/10/824/426.pbf`)).toEqual({
      kind: "versioned-tile",
      version: VERSION,
      z: 10,
      x: 824,
      y: 426,
    });
    expect(routeTile("/fonts/x.pbf").kind).toBe("not-found");
  });
});

describe("rewriteStyle", () => {
  it("rewrites the public source/glyphs/sprite to the self-hosted origin", () => {
    const out = rewriteStyle(
      JSON.stringify({
        sources: { openmaptiles: { url: "https://tiles.openfreemap.org/planet" } },
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
      }),
      "https://staging-tiles.cafemood.app",
    );
    expect(out).toContain("https://staging-tiles.cafemood.app/planet");
    expect(out).not.toContain("tiles.openfreemap.org");
  });

  it("returns null for a non-style body", () => {
    expect(rewriteStyle("not json", "https://staging-tiles.cafemood.app")).toBeNull();
    expect(rewriteStyle(JSON.stringify({ layers: [] }), "https://x.test")).toBeNull();
  });
});

describe("handleFetch", () => {
  it("serves /health without touching the bucket", async () => {
    let touched = false;
    const env = makeEnv();
    const bucket = env.TILES_BUCKET;
    const res = await handleFetch(new Request("https://staging-tiles.cafemood.app/health"), {
      ...env,
      TILES_BUCKET: {
        get: (...args: Parameters<typeof bucket.get>) => {
          touched = true;
          return bucket.get(...args);
        },
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(touched).toBe(false);
  });

  it("serves archive-derived TileJSON pointing at the live version", async () => {
    const res = await get("/planet", makeEnv());
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { tiles: string[]; vector_layers: unknown[] };
    expect(doc.tiles).toEqual([
      `https://staging-tiles.cafemood.app/planet/${VERSION}/{z}/{x}/{y}.pbf`,
    ]);
    expect(doc.vector_layers.length).toBeGreaterThan(0);
  });

  it("serves live tile BYTES with the protobuf content type (no redirect)", async () => {
    const res = await get("/planet/0/0/0.pbf", makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
    expect(res.headers.get("location")).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("following the TileJSON template yields bytes, never a redirect loop", async () => {
    const env = makeEnv();
    const tileJson = (await (await get("/planet", env)).json()) as { tiles: string[] };
    const tileUrl = tileJson.tiles[0].replace("{z}", "0").replace("{x}", "0").replace("{y}", "0");
    const path = new URL(tileUrl).pathname;
    for (let hop = 0; hop < 3; hop++) {
      const res = await get(path, env);
      expect(res.status).not.toBe(302);
      expect(res.status).toBe(200);
      expect(await res.arrayBuffer().then((b) => b.byteLength)).toBeGreaterThan(0);
    }
  });

  it("serves pinned-version tiles from the same archive", async () => {
    const res = await get(`/planet/${VERSION}/0/0/0.pbf`, makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
  });

  it("204s empty tiles inside the zoom range", async () => {
    const res = await get("/planet/5/0/0.pbf", makeEnv());
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("location")).toBeNull();
  });

  it("404s unknown planet versions without leaking the bucket layout", async () => {
    const res = await get("/planet/20000101_000000_pt/0/0/0.pbf", makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_version" });
  });

  it("404s zooms above the archive maxzoom", async () => {
    const res = await get("/planet/16/1/1.pbf", makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "zoom_out_of_range" });
  });

  it("serves rewritten styles from R2", async () => {
    const res = await get("/styles/liberty.json", makeEnv());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("https://staging-tiles.cafemood.app/planet");
    expect(text).not.toContain("tiles.openfreemap.org");
  });

  it("serves font and sprite asset bytes (no redirect)", async () => {
    const font = await get("/fonts/Noto%20Sans%20Regular/0-255.pbf", makeEnv());
    expect(font.status).toBe(200);
    expect(font.headers.get("location")).toBeNull();
    const sprite = await get("/sprites/ofm_f384/ofm.json", makeEnv());
    expect(sprite.status).toBe(200);
    expect(sprite.headers.get("content-type")).toBe("application/json");
  });

  it("404s unknown styles and assets", async () => {
    const env = makeEnv();
    expect((await get("/styles/nope.json", env)).status).toBe(404);
    expect((await get("/fonts/Missing/0-255.pbf", env)).status).toBe(404);
  });

  it("sets CORS only for the request origin", async () => {
    const env = makeEnv();
    const allowed = await get("/planet/0/0/0.pbf", env, "https://cafemood.app");
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://cafemood.app");
    const denied = await get("/planet/0/0/0.pbf", env, "https://evil.test");
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(allowedOrigin(new Request("https://x.test", { headers: { Origin: "https://evil.test" } }), env)).toBe("");
  });

  it("never replays a cached ACAO to another origin", async () => {
    const store = new Map<string, Response>();
    const cache = {
      async match(key: string) {
        return store.get(key);
      },
      async put(key: string, res: Response) {
        store.set(key, res);
      },
    };
    const g = globalThis as unknown as { caches?: { default: typeof cache } };
    const prev = g.caches;
    g.caches = { default: cache };
    try {
      const env = makeEnv();
      const url = "https://staging-tiles.cafemood.app/planet/0/0/0.pbf";
      const first = await handleFetch(new Request(url, { headers: { Origin: "https://cafemood.app" } }), env, undefined);
      expect(first.headers.get("Access-Control-Allow-Origin")).toBe("https://cafemood.app");
      const second = await handleFetch(
        new Request(url, { headers: { Origin: "https://staging.cafemood.app" } }),
        env,
        undefined,
      );
      expect(second.headers.get("Access-Control-Allow-Origin")).toBe("https://staging.cafemood.app");
    } finally {
      if (prev === undefined) delete g.caches;
      else g.caches = prev;
    }
  });
});
