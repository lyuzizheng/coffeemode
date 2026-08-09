import { describe, expect, it, vi } from "vitest";
import { handleFetch } from "../src/handlers";
import type { Env } from "../src/types";
import { FakeD1, FakeKV, googleDetailResponse, mockFetch } from "./helpers";

const TOKEN = "test-token";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    POI_SERVICE_TOKEN: TOKEN,
    GOOGLE_PLACES_API_KEY: "test-google-key",
    POI_KV: new FakeKV(),
    POI_DB: new FakeD1(),
    GOOGLE_PLACES_BASE_URL: "https://places.test",
    ...overrides,
  };
}

async function call(
  method: string,
  path: string,
  env: Env,
  opts: { token?: string; body?: unknown; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const token = "token" in opts ? opts.token : TOKEN;
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["x-poi-service-token"] = token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`https://poi.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return handleFetch(req, env, { fetchImpl: opts.fetchImpl ?? fetch });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await call("GET", "/poi/search?q=coffee", makeEnv(), { token: undefined });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({
      error: "unauthorized",
      message: "missing or invalid service token",
    });
  });

  it("rejects requests with a wrong token", async () => {
    const res = await call("GET", "/poi/search?q=coffee", makeEnv(), { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("accepts bearer authorization header", async () => {
    const env = makeEnv();
    const req = new Request("https://poi.test/poi/search?q=coffee", {
      headers: { authorization: ["Bearer", TOKEN].join(" ") },
    });
    const res = await handleFetch(req, env, { fetchImpl: fetch });
    expect(res.status).toBe(200);
  });

  it("accepts a lowercase bearer scheme (RFC 6750: scheme is case-insensitive)", async () => {
    const env = makeEnv();
    const req = new Request("https://poi.test/poi/search?q=coffee", {
      headers: { authorization: ["bearer", TOKEN].join(" ") },
    });
    const res = await handleFetch(req, env, { fetchImpl: fetch });
    expect(res.status).toBe(200);
  });

  it("fails closed when the env token is empty", async () => {
    const env = makeEnv({ POI_SERVICE_TOKEN: "" });
    const res = await call("GET", "/poi/search?q=coffee", env, { token: "" });
    expect(res.status).toBe(401);
  });
});

describe("GET /poi/:place_id", () => {
  it("serves from KV hot cache without hitting D1/Google", async () => {
    const kv = new FakeKV();
    await kv.put("raw:google:ChIJTEST123", JSON.stringify(googleDetailResponse()));
    const env = makeEnv({ POI_KV: kv });
    const fetchImpl = vi.fn(mockFetch(() => new Response("should not be called", { status: 599 })));

    const res = await call("GET", "/poi/ChIJTEST123", env, { fetchImpl });

    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    expect(b).toMatchObject({ place_id: "ChIJTEST123", name: "Blue Bottle Coffee" });
    expect(b).toHaveProperty("source", "google");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves a fresh D1 row without calling Google", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "ChIJTEST123",
      source: "google",
      name: "Blue Bottle Coffee",
      lat: 37.7825,
      lng: -122.4077,
      address: "66 Mint St",
      types: '["cafe"]',
      business_status: "OPERATIONAL",
      hours_json: null,
      photo_refs: "[]",
      fetched_at: new Date().toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = vi.fn(mockFetch(() => new Response("should not be called", { status: 599 })));

    const res = await call("GET", "/poi/ChIJTEST123", env, { fetchImpl });

    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    expect(b).toMatchObject({ name: "Blue Bottle Coffee", types: ["cafe"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches from Google when cold, backfills KV + D1", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn(
      mockFetch(() => new Response(JSON.stringify(googleDetailResponse()), { status: 200 })),
    );

    const res = await call("GET", "/poi/ChIJTEST123", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("Blue Bottle Coffee");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("places.test/v1/places/ChIJTEST123");
    const init = fetchImpl.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(init?.headers?.["X-Goog-FieldMask"]).toMatch(/^id,/);
    expect((env.POI_KV as FakeKV).has("raw:google:ChIJTEST123")).toBe(true);
    expect((env.POI_DB as FakeD1).rows).toHaveLength(1);
  });

  it("returns 502 on Google failure, but serves stale D1 if present", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "ChIJSTALE",
      source: "google",
      name: "Stale Cafe",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: "[]",
      business_status: null,
      hours_json: null,
      photo_refs: "[]",
      fetched_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), // 30d old
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = mockFetch(() => new Response("boom", { status: 500 }));

    const res = await call("GET", "/poi/ChIJSTALE", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("Stale Cafe");
  });

  it("refreshes a stale google row via Google and updates D1", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "ChIJTEST123",
      source: "google",
      name: "Old Name",
      lat: 0,
      lng: 0,
      address: null,
      types: "[]",
      business_status: null,
      hours_json: null,
      photo_refs: "[]",
      fetched_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify(googleDetailResponse({ displayName: { text: "New Name" } })), {
        status: 200,
      }),
    );

    const res = await call("GET", "/poi/ChIJTEST123", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("New Name");
    expect(db.rows[0].name).toBe("New Name");
  });

  it("serves apple POIs from D1 without calling Google", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "apple-mapkit-ref-1",
      source: "apple",
      name: "Arabica Singapore",
      lat: 1.285,
      lng: 103.85,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      photo_refs: "[]",
      fetched_at: new Date().toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = vi.fn(mockFetch(() => new Response("no", { status: 599 })));

    const res = await call("GET", "/poi/apple-mapkit-ref-1", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res))).toMatchObject({ source: "apple", name: "Arabica Singapore" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("404s unknown apple IDs (no server-side upstream)", async () => {
    const res = await call("GET", "/poi/apple-unknown-9", makeEnv());
    expect(res.status).toBe(404);
  });

  it("decodes percent-encoded Google hex place ids (%3A → ':')", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn(
      mockFetch(() =>
        new Response(
          JSON.stringify(googleDetailResponse({ id: "0x8085:0x9f2c" })),
          { status: 200 },
        ),
      ),
    );

    const res = await call("GET", "/poi/0x8085%3A0x9f2c", env, { fetchImpl });

    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    expect(b.place_id).toBe("0x8085:0x9f2c");
    // The decoded id is used for KV backfill and the Google fetch.
    expect((env.POI_KV as FakeKV).has("raw:google:0x8085:0x9f2c")).toBe(true);
    expect(fetchImpl.mock.calls[0][0] as string).toContain("places.test/v1/places/0x8085%3A0x9f2c");
  });

  it("accepts raw (unencoded) 0x…:0x… ids as before", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify(googleDetailResponse({ id: "0x8085:0x9f2c" })), { status: 200 }),
    );

    const res = await call("GET", "/poi/0x8085:0x9f2c", env, { fetchImpl });
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).place_id).toBe("0x8085:0x9f2c");
  });

  it("400s on malformed percent-encoding in the place id", async () => {
    const res = await call("GET", "/poi/%E0%A4%A", makeEnv());
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe("invalid_request");
  });

  it("falls through corrupt KV cache to D1", async () => {
    const kv = new FakeKV();
    await kv.put("raw:google:ChIJCORRUPT", "{not json!!");
    const db = new FakeD1();
    db.rows.push({
      place_id: "ChIJCORRUPT",
      source: "google",
      name: "Fresh From D1",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: "[]",
      business_status: null,
      hours_json: null,
      photo_refs: "[]",
      fetched_at: new Date().toISOString(),
    });
    const env = makeEnv({ POI_KV: kv, POI_DB: db });
    const fetchImpl = vi.fn(mockFetch(() => new Response("should not be called", { status: 599 })));

    const res = await call("GET", "/poi/ChIJCORRUPT", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("Fresh From D1");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects Google responses missing location instead of storing (0,0)", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(
        JSON.stringify(googleDetailResponse({ location: undefined, id: "ChIJNOLOC" })),
        { status: 200 },
      ),
    );

    const res = await call("GET", "/poi/ChIJNOLOC", env, { fetchImpl });

    expect(res.status).toBe(502);
    expect((await bodyOf(res)).error).toBe("invalid_upstream");
    expect((env.POI_DB as FakeD1).rows).toHaveLength(0);
  });

  it("returns JSON 500 envelope when D1 throws (no raw workerd errors)", async () => {
    const db = new FakeD1();
    db.prepare = () => {
      throw new Error("D1 outage");
    };
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/ChIJTEST123", env);

    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({
      error: "internal_error",
      message: "internal server error",
    });
  });
});

describe("POST /poi/resolve", () => {
  it("resolves a canonical URL with hex place id via Google", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn(
      mockFetch(() => new Response(JSON.stringify(googleDetailResponse()), { status: 200 })),
    );

    const res = await call(
      "POST",
      "/poi/resolve",
      env,
      {
        body: {
          maps_share_url:
            "https://www.google.com/maps/place/Blue+Bottle/@37.7,-122.4,17z/data=!4m6!3m5!1s0x8085809f2f2a2b79:0x9f2c0f1d2e3a4b5c",
        },
        fetchImpl,
      },
    );

    expect(res.status).toBe(200);
    expect((await bodyOf(res))).toMatchObject({ place_id: "ChIJTEST123" });
  });

  it("follows a short link then resolves", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url === "https://maps.app.goo.gl/xyz") {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.google.com/maps/place/Blue+Bottle/data=!4m6!3m5!1s0x8085:0x9f2c!8m2!3d37.7!4d-122.4",
          },
        });
      }
      return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
    });

    const res = await call("POST", "/poi/resolve", env, {
      body: { maps_share_url: "https://maps.app.goo.gl/xyz" },
      fetchImpl,
    });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).place_id).toBe("ChIJTEST123");
  });

  it("falls back to text search when the URL has a query but no place id", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn(
      mockFetch((url, init) => {
        if (String(url).includes("searchText")) {
          const reqHeaders = init?.headers as Record<string, string> | undefined;
          expect(reqHeaders?.["X-Goog-FieldMask"]).toMatch(/^places\./);
          expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "blue bottle" });
          return new Response(JSON.stringify({ places: [googleDetailResponse()] }), { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await call("POST", "/poi/resolve", env, {
      body: { url: "https://www.google.com/maps?q=blue+bottle&um=1" },
      fetchImpl,
    });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("Blue Bottle Coffee");
    expect((env.POI_DB as FakeD1).rows).toHaveLength(1);
  });

  it("400s without maps_share_url", async () => {
    const res = await call("POST", "/poi/resolve", makeEnv(), { body: {} });
    expect(res.status).toBe(400);
  });

  it("422s when nothing resolvable is in the URL", async () => {
    const res = await call("POST", "/poi/resolve", makeEnv(), {
      body: { maps_share_url: "https://example.com/not-a-maps-link" },
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /poi/search", () => {
  function seed(db: FakeD1): void {
    const now = new Date().toISOString();
    const rows = [
      ["g1", "google", "Blue Bottle Mint", 37.7825, -122.4077],
      ["g2", "google", "Blue Bottle Hayes", 37.7764, -122.4244],
      ["g3", "google", "Arabica Anchor", 1.285, 103.85],
      ["a1", "apple", "Apartment Coffee", 37.7826, -122.4078],
    ];
    for (const [place_id, source, name, lat, lng] of rows) {
      db.rows.push({
        place_id, source, name, lat, lng,
        address: null, types: '["cafe"]', business_status: null,
        hours_json: null, photo_refs: "[]", fetched_at: now,
      });
    }
  }

  it("matches by name and sorts by haversine distance within radius", async () => {
    const db = new FakeD1();
    seed(db);
    const env = makeEnv({ POI_DB: db });

    // Centered on Mint St (the first row): Hayes should rank 2nd, Arabica filtered out.
    const res = await call("GET", "/poi/search?q=blue&lat=37.7825&lng=-122.4077&r=10", env);

    expect(res.status).toBe(200);
    const b = await bodyOf(res);
    const results = b.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ place_id: "g1", distance_km: 0 });
    expect(results[1]).toMatchObject({ place_id: "g2" });
    expect((results[1].distance_km as number)).toBeGreaterThan(0);
  });

  it("matches by name without coordinates", async () => {
    const db = new FakeD1();
    seed(db);
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/search?q=arabica", env);
    const b = await bodyOf(res);
    const results = b.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ place_id: "g3" });
    expect(results[0]).not.toHaveProperty("distance_km");
  });

  it("lists all POIs when only coords+radius are given", async () => {
    const db = new FakeD1();
    seed(db);
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/search?lat=37.7825&lng=-122.4077&r=1", env);
    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as unknown[];
    expect(results).toHaveLength(2); // g1 + a1 within 1km, g2 outside
  });

  it("400s without q or coords", async () => {
    const res = await call("GET", "/poi/search", makeEnv());
    expect(res.status).toBe(400);
  });

  it("400s on invalid radius", async () => {
    const res = await call("GET", "/poi/search?q=x&r=abc", makeEnv());
    expect(res.status).toBe(400);
  });

  it("400s on negative radius", async () => {
    const res = await call("GET", "/poi/search?q=x&r=-1", makeEnv());
    expect(res.status).toBe(400);
  });

  it("400s when the radius exceeds the cap", async () => {
    const res = await call("GET", "/poi/search?q=x&r=1e9", makeEnv());
    expect(res.status).toBe(400);
    expect(String((await bodyOf(res)).message)).toContain("200");
  });

  it("400s on out-of-range or non-finite coordinates", async () => {
    for (const qs of [
      "q=x&lat=1e15&lng=103",
      "q=x&lat=37&lng=200",
      "q=x&lat=Infinity&lng=103",
      "q=x&lat=37", // lat without lng
    ]) {
      const res = await call("GET", `/poi/search?${qs}`, makeEnv());
      expect(res.status).toBe(400);
    }
  });

  it("caps the number of results", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    for (let i = 0; i < 150; i++) {
      db.rows.push({
        place_id: `bulk-${i}`,
        source: "google",
        name: `Cafe ${String(i).padStart(3, "0")}`,
        lat: 1.3,
        lng: 103.8,
        address: null,
        types: '["cafe"]',
        business_status: null,
        hours_json: null,
        photo_refs: "[]",
        fetched_at: now,
      });
    }
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/search?q=Cafe", env);
    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as unknown[];
    expect(results).toHaveLength(100);
  });
});

describe("POST /poi/external", () => {
  it("stores an array of POIs and reports the count", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "apple-ref-1", source: "apple", name: "Kaffeelix", lat: 1.28, lng: 103.84 },
          { place_id: "ChIJEXT2", source: "google", name: "Tiong Bahru Bakery", lat: 1.285, lng: 103.827 },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ stored: 2 });
    expect((env.POI_DB as FakeD1).rows).toHaveLength(2);
  });

  it("accepts a bare array", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: [{ place_id: "apple-1", source: "apple", name: "Coffea", lat: 1.3, lng: 103.9 }],
    });
    expect(res.status).toBe(200);
    expect((env.POI_DB as FakeD1).rows).toHaveLength(1);
  });

  it("400s with per-entry reasons on invalid entries", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: {
        pois: [
          { place_id: "ok", source: "apple", name: "Fine", lat: 1, lng: 103 },
          { place_id: "", source: "google", name: "Bad", lat: 1, lng: 103 },
          { place_id: "x", source: "yahoo", name: "Bad2", lat: 1, lng: 103 },
          { place_id: "y", source: "google", name: "Bad3" },
        ],
      },
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    expect(b.error).toBe("invalid_request");
    expect((b.entries as Array<{ index: number; reason: string }>).map((e) => e.index)).toEqual([
      1, 2, 3,
    ]);
  });

  it("400s on empty payloads", async () => {
    expect((await call("POST", "/poi/external", makeEnv(), { body: {} })).status).toBe(400);
    expect((await call("POST", "/poi/external", makeEnv(), { body: { pois: [] } })).status).toBe(400);
  });

  it("400s when the batch exceeds the entry cap", async () => {
    const pois = Array.from({ length: 101 }, (_, i) => ({
      place_id: `bulk-${i}`,
      source: "apple",
      name: `Cafe ${i}`,
      lat: 1.3,
      lng: 103.8,
    }));
    const res = await call("POST", "/poi/external", makeEnv(), { body: { pois } });
    expect(res.status).toBe(400);
    expect(String((await bodyOf(res)).message)).toContain("100");
  });

  it("upserts via a single atomic db.batch() call", async () => {
    const db = new FakeD1();
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "b1", source: "apple", name: "One", lat: 1, lng: 103 },
          { place_id: "b2", source: "apple", name: "Two", lat: 1, lng: 103 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(db.batchCalls).toBe(1);
    expect(db.rows).toHaveLength(2);
  });

  it("rejects out-of-range coordinates like lat 1e15", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: {
        pois: [
          { place_id: "a", source: "google", name: "Far", lat: 1e15, lng: 103 },
          { place_id: "b", source: "google", name: "Far", lat: 1, lng: -999 },
        ],
      },
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    expect((b.entries as Array<{ index: number; reason: string }>).map((e) => e.index)).toEqual([0, 1]);
  });

  it("rejects non-string array elements in types/photo_refs", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: {
        pois: [
          { place_id: "a", source: "google", name: "A", lat: 1, lng: 103, types: ["cafe", 7] },
          { place_id: "b", source: "google", name: "B", lat: 1, lng: 103, photo_refs: [null] },
          { place_id: "c", source: "google", name: "C", lat: 1, lng: 103, types: "cafe" },
        ],
      },
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    const entries = b.entries as Array<{ index: number; reason: string }>;
    expect(entries.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(entries[0].reason).toContain("types");
    expect(entries[1].reason).toContain("photo_refs");
  });

  it("caps string field lengths", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: {
        pois: [
          { place_id: "a", source: "apple", name: "x".repeat(201), lat: 1, lng: 103 },
          { place_id: "b", source: "apple", name: "Ok", lat: 1, lng: 103, address: "y".repeat(1001) },
        ],
      },
    });
    expect(res.status).toBe(400);
    const entries = ((await bodyOf(res)).entries as Array<{ index: number; reason: string }>).map(
      (e) => e.index,
    );
    expect(entries).toEqual([0, 1]);
  });
});

describe("router", () => {
  it("404s unknown routes and wrong methods", async () => {
    expect((await call("GET", "/poi", makeEnv())).status).toBe(404);
    expect((await call("DELETE", "/poi/ChIJTEST123", makeEnv())).status).toBe(404);
    expect((await call("POST", "/poi/search", makeEnv())).status).toBe(404);
  });
});