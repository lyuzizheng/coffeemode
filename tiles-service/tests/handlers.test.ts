import { describe, expect, it } from "vitest";
import { handleFetch } from "../src/handlers";
import { rewriteStyle, routeTile, tilesJson } from "../src/tilejson";
import type { Env } from "../src/types";

const VERSION = "20260913_164504_pt";
function makeEnv(objects: Record<string, string> = {}): Env {
  return {
    TILES_BUCKET: {
      async get(key: string) {
        const etag = objects[key];
        if (!etag) return null;
        const body = key.startsWith("styles/")
          ? JSON.stringify({
              version: 8,
              sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
              glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
              sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
              layers: [],
            })
          : "bytes";
        return {
          size: body.length,
          etag,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            },
          }),
          writeHttpMetadata() {},
        };
      },
      async head(key: string) {
        const etag = objects[key];
        if (!etag) return null;
        return { size: 1024, etag, writeHttpMetadata() {} };
      },
    },
    PLANET_VERSION: VERSION,
    TILES_PUBLIC_ORIGIN: "https://staging-tiles.cafemood.app",
  };
}

function get(path: string, env: Env): Promise<Response> {
  return handleFetch(new Request(`https://staging-tiles.cafemood.app${path}`), env);
}

describe("routeTile", () => {
  it("routes the TileJSON, live tiles, and pinned tiles", () => {
    expect(routeTile("/planet")).toEqual({ kind: "tilejson" });
    expect(routeTile("/planet/10/824/426.pbf")).toMatchObject({ kind: "tile", z: 10 });
    expect(routeTile(`/planet/${VERSION}/10/824/426.pbf`)).toMatchObject({
      kind: "versioned-tile",
      version: VERSION,
    });
    expect(routeTile("/fonts/x.pbf").kind).toBe("not-found");
  });
});

describe("tilesJson", () => {
  it("points the tiles template at the live version on this origin", () => {
    const doc = tilesJson("https://staging-tiles.cafemood.app", VERSION) as {
      tiles: string[];
      maxzoom: number;
    };
    expect(doc.tiles).toEqual([
      `https://staging-tiles.cafemood.app/planet/${VERSION}/{z}/{x}/{y}.pbf`,
    ]);
    expect(doc.maxzoom).toBe(14);
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
    const res = await get("/health", makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves the TileJSON for the live version", async () => {
    const res = await get("/planet", makeEnv());
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { tiles: string[] };
    expect(doc.tiles[0]).toContain(VERSION);
  });

  it("redirects live tiles to the versioned PBF URL with a fingerprint", async () => {
    const env = makeEnv({ [`planet/${VERSION}/planet.pmtiles`]: '"abc123"' });
    const res = await get("/planet/10/824/426.pbf", env);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`https://staging-tiles.cafemood.app/planet/${VERSION}/10/824/426.pbf?v=abc123`);
  });

  it("404s unknown planet versions without leaking the bucket layout", async () => {
    const res = await get("/planet/20000101_000000_pt/10/1/1.pbf", makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_version" });
  });

  it("404s zooms above the TileJSON maxzoom", async () => {
    const env = makeEnv({ [`planet/${VERSION}/planet.pmtiles`]: '"abc123"' });
    const res = await get("/planet/15/1/1.pbf", env);
    expect(res.status).toBe(404);
  });

  it("serves rewritten styles from R2", async () => {
    const env = makeEnv({ "styles/liberty.json": '"style-etag"' });
    const res = await get("/styles/liberty.json", env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("https://staging-tiles.cafemood.app/planet");
    expect(text).not.toContain("tiles.openfreemap.org");
  });

  it("404s unknown styles and assets", async () => {
    const env = makeEnv();
    expect((await get("/styles/nope.json", env)).status).toBe(404);
    expect((await get("/fonts/Noto%20Sans%20Regular/0-255.pbf", env)).status).toBe(404);
  });
});
