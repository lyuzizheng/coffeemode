import { describe, expect, it, vi } from "vitest";
import { handleFetch } from "../src/handlers";
import type { Env, POI, PlacePrediction } from "../src/types";
import { FakeD1, FakeKV, autocompleteSuggestion, googleDetailResponse, mockFetch } from "./helpers";

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
  opts: { token?: string; body?: unknown; fetchImpl?: typeof fetch; headers?: Record<string, string> } = {},
): Promise<Response> {
  const token = "token" in opts ? opts.token : TOKEN;
  const headers: Record<string, string> = { ...opts.headers };
  if (token !== undefined) headers["x-poi-service-token"] = token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`https://poi.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return handleFetch(req, env, { fetchImpl: opts.fetchImpl ?? fetch });
}

/** Decode a JSON response body. The cast is the boundary decode — the
 *  assertion that follows is what proves the shape. */
async function bodyOf<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("health and info", () => {
  it("responds 200 on unauthenticated GET /", async () => {
    const res = await call("GET", "/", makeEnv(), { token: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "poi-service" });
  });

  it("responds 200 on unauthenticated GET /health", async () => {
    const res = await call("GET", "/health", makeEnv(), { token: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "poi-service" });
  });
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await call("GET", "/poi/search?q=coffee", makeEnv(), { token: undefined });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "unauthorized",
      message: "missing or invalid service token",
    });
  });

  it("echoes inbound x-request-id on the error body and header", async () => {
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const res = await call("GET", "/poi/search?q=coffee", makeEnv(), {
      token: undefined,
      headers: { "x-request-id": requestId },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBe(requestId);
    expect((await res.json()) as { request_id?: string }).toMatchObject({
      request_id: requestId,
    });
  });

  it("generates request_id when x-request-id is absent", async () => {
    const res = await call("GET", "/poi/search?q=coffee", makeEnv(), { token: undefined });
    const body = (await res.json()) as { request_id?: string };
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-request-id")).toBe(body.request_id);
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

  it("never logs key= when the Google upstream fails (P0 secret scrub)", async () => {
    // A hostile upstream-shaped error carrying the keyed request URL must be
    // scrubbed before it reaches the log line — the unit under test is the
    // shared log scrub, exercised through a forced handler catch path.
    const { logError } = await import("../../web/shared/log");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logError({
        route: "GET /poi/reverse",
        request: new Request("https://poi.test/poi/reverse", { method: "POST" }),
        error: new Error(
          "Geocoding failed: https://maps.googleapis.com/maps/api/geocode/json?latlng=1,2&key=SECRET (upstream status 500)",
        ),
        status: 502,
      });
      expect(errorSpy).toHaveBeenCalled();
      for (const args of errorSpy.mock.calls) {
        for (const arg of args) {
          expect(String(arg)).not.toContain("key=");
          expect(String(arg)).not.toContain("SECRET");
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("GET /poi/:place_id", () => {
  it("serves from KV hot cache without hitting D1/Google", async () => {
    const kv = new FakeKV();
    const cachedPoi = {
      place_id: "ChIJTEST123",
      source: "google",
      name: "Blue Bottle Coffee",
      lat: 37.7825,
      lng: -122.4077,
      address: "66 Mint St, San Francisco, CA 94103",
      types: ["cafe", "coffee_shop"],
      business_status: "OPERATIONAL",
      hours_json: JSON.stringify({ periods: [] }),
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
    await kv.put("poi:ChIJTEST123", JSON.stringify(cachedPoi));
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
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
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
    expect((env.POI_KV as FakeKV).has("poi:ChIJTEST123")).toBe(true);
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
      fetched_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(), // 14d old: stale (>7d) but unexpired (<30d)
      expires_at: new Date(Date.now() + 16 * 24 * 3600 * 1000).toISOString(),
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
      fetched_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 16 * 24 * 3600 * 1000).toISOString(),
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
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = vi.fn(mockFetch(() => new Response("no", { status: 599 })));

    const res = await call("GET", "/poi/apple-mapkit-ref-1", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res))).toMatchObject({ source: "apple", name: "Arabica Singapore" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("trusts stored source over the prefix heuristic: stale ChIJ-prefixed apple row is served, not fanned out to Google (issue #38)", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "ChIJAPPLE9",
      source: "apple",
      name: "Apple Ref Cafe",
      lat: 1.285,
      lng: 103.85,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 16 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = vi.fn(mockFetch(() => new Response("no", { status: 599 })));

    const res = await call("GET", "/poi/ChIJAPPLE9", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res))).toMatchObject({ source: "apple", name: "Apple Ref Cafe" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes a stale google row whose id lacks the ChIJ/0x prefix (issue #38)", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "goog-new-format-1",
      source: "google",
      name: "Old Name",
      lat: 0,
      lng: 0,
      address: null,
      types: "[]",
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 16 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const fetchImpl = mockFetch(() =>
      new Response(
        JSON.stringify(
          googleDetailResponse({ id: "goog-new-format-1", displayName: { text: "Fresh Name" } }),
        ),
        { status: 200 },
      ),
    );

    const res = await call("GET", "/poi/goog-new-format-1", env, { fetchImpl });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).name).toBe("Fresh Name");
    expect(db.rows[0].name).toBe("Fresh Name");
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
    expect((env.POI_KV as FakeKV).has("poi:0x8085:0x9f2c")).toBe(true);
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
    await kv.put("poi:ChIJCORRUPT", "{not json!!");
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
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
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
    expect(await bodyOf(res)).toMatchObject({
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

  it("resolves a query-only URL through autocomplete then details", async () => {
    const env = makeEnv();
    const fetchImpl = vi.fn(
      mockFetch((url, init) => {
        if (String(url).includes("places:autocomplete")) {
          const body = JSON.parse(String(init?.body)) as { input?: string; sessionToken?: string };
          expect(body.input).toBe("blue bottle");
          // The session must be a real UUID: Google ignores anything else and
          // the lookup would silently bill per request.
          expect(body.sessionToken).toMatch(/^[0-9a-f-]{36}$/);
          return new Response(
            JSON.stringify({ suggestions: [autocompleteSuggestion({ placeId: "ChIJTEST123" })] }),
            { status: 200 },
          );
        }
        if (String(url).includes("/v1/places/ChIJTEST123")) {
          // The Details call must carry the SAME token, or the session never
          // terminates and the Autocomplete calls are billed.
          const autocompleteToken = (
            JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { sessionToken: string }
          ).sessionToken;
          expect(String(url)).toContain(`sessionToken=${autocompleteToken}`);
          return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
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

  it("resolves an Apple Maps share link into a stored Apple POI", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/resolve", env, {
      body: {
        maps_share_url:
          "https://maps.apple.com/?auid=apple-123&ll=1.285,103.85&q=Arabica%20Singapore",
      },
    });

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({
      place_id: "apple-123",
      source: "apple",
      name: "Arabica Singapore",
      lat: 1.285,
      lng: 103.85,
    });
    expect((env.POI_DB as FakeD1).rows).toHaveLength(1);
  });

  it("resolves an Apple place-id-only link from public page metadata", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://maps.apple.com/place?place-id=I123");
      expect(init?.method).toBe("GET");
      return new Response(
        '<meta property="place:location:latitude" content="1.285"><meta property="place:location:longitude" content="103.85"><meta property="og:title" content="Arabica Singapore">',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const res = await call("POST", "/poi/resolve", env, {
      body: { maps_share_url: "https://maps.apple.com/place?place-id=I123" },
      fetchImpl,
    });

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({
      place_id: "I123",
      source: "apple",
      name: "Arabica Singapore",
      lat: 1.285,
      lng: 103.85,
    });
  });

  it("422s an Apple URL whose auid is a Google id (BRAWUKA-566)", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    const fresh = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    db.rows.push({
      place_id: "ChIJREALCAFE9",
      source: "google",
      name: "Real Cafe",
      lat: 1.285,
      lng: 103.85,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: fresh,
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/resolve", env, {
      body: { maps_share_url: "https://maps.apple.com/?auid=ChIJREALCAFE9&ll=1.285,103.85&q=Forged%20Cafe" },
    });

    expect(res.status).toBe(422);
    // The real Google row is untouched.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].name).toBe("Real Cafe");
  });

  it("409s when an Apple URL key belongs to a stored google row (BRAWUKA-566)", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    const fresh = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    db.rows.push({
      place_id: "shared-key-1",
      source: "google",
      name: "Real Cafe",
      lat: 1.285,
      lng: 103.85,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: fresh,
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/resolve", env, {
      body: { maps_share_url: "https://maps.apple/place?place-id=shared-key-1&ll=1.285,103.85&q=Forged%20Cafe" },
    });

    expect(res.status).toBe(409);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].name).toBe("Real Cafe");
    // getPOI still serves the real row.
    const getRes = await call("GET", "/poi/shared-key-1", env, {
      fetchImpl: vi.fn(mockFetch(() => new Response("should not be called", { status: 599 }))),
    });
    expect(getRes.status).toBe(200);
    expect((await bodyOf(getRes)).name).toBe("Real Cafe");
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
        hours_json: null, fetched_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
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

  it("wraps the longitude box across the antimeridian (issue #38)", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    const rows = [
      ["fj-e", "Fiji East", 1.3, 179.9],
      ["fj-w", "Fiji West", 1.3, -179.9],
      ["far", "Faraway", 1.3, 170.0],
    ];
    for (const [place_id, name, lat, lng] of rows) {
      db.rows.push({
        place_id, source: "google", name, lat, lng,
        address: null, types: '["cafe"]', business_status: null,
        hours_json: null, fetched_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      });
    }
    const env = makeEnv({ POI_DB: db });

    // Center 179.8°E: fj-w at -179.9° is ~33 km away across the antimeridian.
    const res = await call("GET", "/poi/search?lat=1.3&lng=179.8&r=50", env);

    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as Array<Record<string, unknown>>;
    expect(results.map((r) => r.place_id)).toEqual(["fj-e", "fj-w"]);
  });

  it("spans all longitudes for near-pole searches (no lng prefilter)", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    for (const [place_id, lng] of [["np-a", 170], ["np-b", -170], ["np-c", 10]]) {
      db.rows.push({
        place_id, source: "google", name: `Pole ${place_id}`, lat: 89.4, lng,
        address: null, types: '["cafe"]', business_status: null,
        hours_json: null, fetched_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      });
    }
    const env = makeEnv({ POI_DB: db });

    // At lat 89.5 the 200 km box covers ~206° of longitude — wider than any
    // wrapped interval pair could express; every nearby row must match.
    const res = await call("GET", "/poi/search?lat=89.5&lng=0&r=200", env);

    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as Array<Record<string, unknown>>;
    expect(results.map((r) => r.place_id).sort()).toEqual(["np-a", "np-b", "np-c"]);
  });

  it("400s without q or coords", async () => {
    const res = await call("GET", "/poi/search", makeEnv());
    expect(res.status).toBe(400);
  });

  it("400s on invalid radius", async () => {
    const res = await call("GET", "/poi/search?q=x&r=abc", makeEnv());
    expect(res.status).toBe(400);
  });

  it.each([
    ["lat", "q=x&lat=37.7junk&lng=-122.4"],
    ["lng", "q=x&lat=37.7&lng=-122.4junk"],
    ["r", "q=x&r=5km"],
  ])("400s on trailing junk in %s", async (_param, query) => {
    const res = await call("GET", `/poi/search?${query}`, makeEnv());

    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe("invalid_request");
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
        fetched_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      });
    }
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/search?q=Cafe", env);
    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as unknown[];
    expect(results).toHaveLength(100);
  });

  it("keeps the nearest POI when name matches exceed the prefetch cap (BRAWUKA-395)", async () => {
    // >1000 name matches inside the bbox: an alphabetical prefetch truncates
    // before the distance sort and drops the POI sitting on the search point.
    const db = new FakeD1();
    const now = new Date().toISOString();
    for (let i = 0; i < 1100; i++) {
      db.rows.push({
        place_id: `bulk-${String(i).padStart(4, "0")}`,
        source: "google",
        name: `Cafe ${String(i).padStart(4, "0")}`,
        lat: 1.305 + (i % 10) * 0.01,
        lng: 103.805 + (i % 10) * 0.01,
        types: '["cafe"]',
        business_status: null,
        hours_json: null,
        fetched_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      });
    }
    db.rows.push({
      place_id: "nearest",
      source: "google",
      name: "Zebra Cafe", // sorts last alphabetically — dropped by a name-ordered prefetch
      lat: 1.3,
      lng: 103.8,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });

    const res = await call("GET", "/poi/search?q=cafe&lat=1.3&lng=103.8&r=50", env);

    expect(res.status).toBe(200);
    const results = (await bodyOf(res)).results as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ place_id: "nearest", distance_km: 0 });
  });
});

describe("GET /poi/autocomplete", () => {
  const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("returns predictions and persists nothing", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      expect(String(url)).toContain("places.test/v1/places:autocomplete");
      return new Response(
        JSON.stringify({
          suggestions: [
            autocompleteSuggestion({ placeId: "ChIJLIVE" }),
            autocompleteSuggestion({ placeId: "ChIJNOLOCATION" }),
          ],
        }),
        { status: 200 },
      );
    });

    const res = await call("GET", `/poi/autocomplete?q=blue%20bottle&r=5&session=${SESSION}`, env, {
      fetchImpl,
    });

    expect(res.status).toBe(200);
    const body = await bodyOf<{ predictions: PlacePrediction[] }>(res);
    expect(body.predictions).toHaveLength(2);
    expect(body.predictions[0]).toMatchObject({
      place_id: "ChIJLIVE",
      name: "Blue Bottle Coffee",
      address: "Mint St, San Francisco",
    });
    // A prediction has no coordinates, so there is no POI to store — the
    // billed Place Details call on selection is what persists.
    expect((env.POI_DB as FakeD1).rows).toHaveLength(0);
  });

  it("forwards the session token and location bias upstream", async () => {
    const env = makeEnv();
    let sent: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    });

    await call("GET", `/poi/autocomplete?q=kopi&lat=1.29&lng=103.85&r=5&session=${SESSION}`, env, {
      fetchImpl,
    });

    expect(sent).toMatchObject({
      input: "kopi",
      sessionToken: SESSION,
      locationBias: { circle: { center: { latitude: 1.29, longitude: 103.85 }, radius: 5000 } },
    });
  });

  it("requires a text query", async () => {
    const res = await call("GET", `/poi/autocomplete?session=${SESSION}`, makeEnv());
    expect(res.status).toBe(400);
  });

  it("rejects a session token that is not a UUID", async () => {
    // Google silently drops a malformed token, which reverts the whole
    // session to per-request billing — so this is a cost guard.
    const res = await call("GET", "/poi/autocomplete?q=kopi&session=not-a-uuid", makeEnv());
    expect(res.status).toBe(400);
  });

  it("caps the number of predictions", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(
        JSON.stringify({
          suggestions: Array.from({ length: 150 }, (_, i) =>
            autocompleteSuggestion({ placeId: `ChIJ${i}` }),
          ),
        }),
        { status: 200 },
      ),
    );

    const res = await call("GET", `/poi/autocomplete?q=cafe&session=${SESSION}`, env, { fetchImpl });
    expect(res.status).toBe(200);
    expect((await bodyOf<{ predictions: unknown[] }>(res)).predictions).toHaveLength(100);
  });
});

describe("POST /poi/external", () => {
  it("stores an array of POIs and reports the count", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "apple-ref-1", source: "apple", name: "Kaffeelix", lat: 1.28, lng: 103.84, types: ["Cafe"] },
          { place_id: "ChIJEXT2", source: "google", name: "Tiong Bahru Bakery", lat: 1.285, lng: 103.827, types: ["bakery"] },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ stored: 2, skipped: [] });
    expect((env.POI_DB as FakeD1).rows).toHaveLength(2);
  });

  it("accepts a bare array", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: [{ place_id: "apple-1", source: "apple", name: "Coffea", lat: 1.3, lng: 103.9, types: ["Cafe"] }],
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ stored: 1, skipped: [] });
    expect((env.POI_DB as FakeD1).rows).toHaveLength(1);
  });

  it("preserves long opaque provider references", async () => {
    const env = makeEnv();
    const placeId = `apple:${"x".repeat(700)}`;
    const res = await call("POST", "/poi/external", env, {
      body: [{ place_id: placeId, source: "apple", name: "Coffea", lat: 1.3, lng: 103.9, types: ["Cafe"] }],
    });

    expect(res.status).toBe(200);
    expect((env.POI_DB as FakeD1).rows[0].place_id).toBe(placeId);
  });

  it("rejects absurdly long provider references", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: [
        { place_id: `apple:${"x".repeat(2000)}`, source: "apple", name: "Coffea", lat: 1.3, lng: 103.9 },
      ],
    });

    expect(res.status).toBe(400);
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
    const pois = Array.from({ length: 51 }, (_, i) => ({
      place_id: `bulk-${i}`,
      source: "apple",
      name: `Cafe ${i}`,
      lat: 1.3,
      lng: 103.8,
    }));
    const res = await call("POST", "/poi/external", makeEnv(), { body: { pois } });
    expect(res.status).toBe(400);
    expect(String((await bodyOf(res)).message)).toContain("50");
  });

  it("upserts via a single atomic db.batch() call", async () => {
    const db = new FakeD1();
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "b1", source: "apple", name: "One", lat: 1, lng: 103, types: ["Cafe"] },
          { place_id: "b2", source: "apple", name: "Two", lat: 1, lng: 103, types: ["Restaurant"] },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(db.batchCalls).toBe(1);
  });

  it("invalidates the KV hot cache so GET serves the fresh D1 row (BRAWUKA-283 P2-1)", async () => {
    const kv = new FakeKV();
    await kv.put("poi:ChIJSTALECACHE", JSON.stringify(googleDetailResponse()));
    const env = makeEnv({ POI_KV: kv });

    const storeRes = await call("POST", "/poi/external", env, {
      body: [
        {
          place_id: "ChIJSTALECACHE",
          source: "google",
          name: "Renamed Cafe",
          lat: 37.78,
          lng: -122.4,
          types: ["cafe"],
        },
      ],
    });
    expect(storeRes.status).toBe(200);
    expect(kv.has("poi:ChIJSTALECACHE")).toBe(false);

    const fetchImpl = vi.fn(mockFetch(() => new Response("should not be called", { status: 599 })));
    const getRes = await call("GET", "/poi/ChIJSTALECACHE", env, { fetchImpl });
    expect(getRes.status).toBe(200);
    expect((await bodyOf(getRes)).name).toBe("Renamed Cafe");
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("rejects non-string array elements in types", async () => {
    const res = await call("POST", "/poi/external", makeEnv(), {
      body: {
        pois: [
          { place_id: "a", source: "google", name: "A", lat: 1, lng: 103, types: ["cafe", 7] },
          { place_id: "b", source: "google", name: "B", lat: 1, lng: 103, types: "cafe" },
        ],
      },
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    const entries = b.entries as Array<{ index: number; reason: string }>;
    expect(entries.map((e) => e.index)).toEqual([0, 1]);
    expect(entries[0].reason).toContain("types");
    expect(entries[1].reason).toContain("types");
  });

  it("rejects unparseable hours_json, accepts valid JSON (issue #39)", async () => {
    const db = new FakeD1();
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "a", source: "google", name: "A", lat: 1, lng: 103, hours_json: "{not json" },
          { place_id: "b", source: "google", name: "B", lat: 1, lng: 103, hours_json: '{"mon":"09:00-18:00"}' },
        ],
      },
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    const entries = b.entries as Array<{ index: number; reason: string }>;
    expect(entries.map((e) => e.index)).toEqual([0]);
    expect(entries[0].reason).toContain("hours_json");
    // Validation happens before any batch call: nothing was written.
    expect(db.batchCalls).toBe(0);
    expect(db.rows).toHaveLength(0);
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

  it("skips non-food Apple POIs without persisting, keeps food ones (BRAWUKA-328)", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "apple-bank", source: "apple", name: "Bank", lat: 1.3, lng: 103.9, types: ["Bank"] },
          { place_id: "apple-cafe", source: "apple", name: "Cafe", lat: 1.31, lng: 103.91, types: ["Cafe"] },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ stored: 1, skipped: [{ index: 0, reason: "non_food_category" }] });
    expect((env.POI_DB as FakeD1).rows.map((row) => row.place_id)).toEqual(["apple-cafe"]);
  });

  it("skips non-food Google POIs via this path too, keeps behavior consistent", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "ChIJATM", source: "google", name: "ATM", lat: 1.3, lng: 103.9, types: ["atm", "bank"] },
          { place_id: "ChIJCAFE", source: "google", name: "Cafe", lat: 1.31, lng: 103.91, types: ["cafe"] },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ stored: 1, skipped: [{ index: 0, reason: "non_food_category" }] });
    expect((env.POI_DB as FakeD1).rows.map((row) => row.place_id)).toEqual(["ChIJCAFE"]);
  });

  it("fails closed on unknown Apple categories and on empty types (BRAWUKA-328)", async () => {
    const env = makeEnv();
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          { place_id: "apple-unknown", source: "apple", name: "Mystery", lat: 1.3, lng: 103.9, types: ["TimeTravelParlor"] },
          { place_id: "apple-empty", source: "apple", name: "Typeless", lat: 1.31, lng: 103.91 },
          { place_id: "google-empty", source: "google", name: "Typeless", lat: 1.32, lng: 103.92, types: [] },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      stored: 0,
      skipped: [
        { index: 0, reason: "non_food_category" },
        { index: 1, reason: "non_food_category" },
        { index: 2, reason: "non_food_category" },
      ],
    });
    expect((env.POI_DB as FakeD1).rows).toHaveLength(0);
  });

  it("still invalidates the KV hot cache only for persisted ids (BRAWUKA-328)", async () => {
    const kv = new FakeKV();
    await kv.put("poi:ChIJKEPT", JSON.stringify(googleDetailResponse()));
    const env = makeEnv({ POI_KV: kv });
    const res = await call("POST", "/poi/external", env, {
      body: [
        { place_id: "ChIJKEPT", source: "google", name: "Kept Cafe", lat: 37.78, lng: -122.4, types: ["cafe"] },
        { place_id: "apple-skipped", source: "apple", name: "Skipped Bank", lat: 1.3, lng: 103.9, types: ["Bank"] },
      ],
    });
    expect(res.status).toBe(200);
    expect(kv.has("poi:ChIJKEPT")).toBe(false);
    expect((env.POI_DB as FakeD1).rows.map((row) => row.place_id)).toEqual(["ChIJKEPT"]);
  });

  it("rejects apple entries carrying Google-shaped ids (BRAWUKA-566)", async () => {
    const db = new FakeD1();
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/external", env, {
      body: [
        { place_id: "ChIJFORGED1", source: "apple", name: "Forged", lat: 1.3, lng: 103.9, types: ["Cafe"] },
        { place_id: "0x8085:0x9f2c", source: "apple", name: "Forged Hex", lat: 1.3, lng: 103.9, types: ["Cafe"] },
      ],
    });
    expect(res.status).toBe(400);
    const entries = (await bodyOf(res)).entries as Array<{ index: number; reason: string }>;
    expect(entries.map((e) => e.index)).toEqual([0, 1]);
    // Validation happens before any batch call: nothing was written.
    expect(db.batchCalls).toBe(0);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses cross-source overwrites but allows same-source upserts (BRAWUKA-566)", async () => {
    const db = new FakeD1();
    const now = new Date().toISOString();
    const fresh = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    db.rows.push({
      place_id: "shared-google-1",
      source: "google",
      name: "Real Cafe",
      lat: 1.285,
      lng: 103.85,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: fresh,
    });
    db.rows.push({
      place_id: "apple-real-1",
      source: "apple",
      name: "Real Apple Cafe",
      lat: 1.3,
      lng: 103.9,
      address: null,
      types: '["Cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: now,
      expires_at: fresh,
    });
    const kv = new FakeKV();
    await kv.put("poi:shared-google-1", JSON.stringify(googleDetailResponse()));
    const env = makeEnv({ POI_DB: db, POI_KV: kv });
    const res = await call("POST", "/poi/external", env, {
      body: [
        { place_id: "shared-google-1", source: "apple", name: "Forged", lat: 1.3, lng: 103.9, types: ["Cafe"] },
        { place_id: "apple-real-1", source: "google", name: "Forged", lat: 1.3, lng: 103.9, types: ["cafe"] },
        { place_id: "apple-real-1", source: "apple", name: "Renamed Apple Cafe", lat: 1.3, lng: 103.9, types: ["Cafe"] },
      ],
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      stored: 1,
      skipped: [
        { index: 0, reason: "source_conflict" },
        { index: 1, reason: "source_conflict" },
      ],
    });
    expect(db.rows.find((r) => r.place_id === "shared-google-1")?.name).toBe("Real Cafe");
    expect(db.rows.find((r) => r.place_id === "apple-real-1")?.name).toBe("Renamed Apple Cafe");
    // The conflicting apple write never touched D1 or evicted the legit KV entry.
    expect(kv.has("poi:shared-google-1")).toBe(true);
  });
});

describe("POST /poi/reverse", () => {
  it("rejects unauthenticated request with 401", async () => {
    const res = await call("POST", "/poi/reverse", makeEnv(), {
      token: undefined,
      body: { lat: 37.7, lng: -122.4 },
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing or non-numeric lat/lng with 400", async () => {
    const env = makeEnv();
    expect((await call("POST", "/poi/reverse", env, { body: {} })).status).toBe(400);
    expect((await call("POST", "/poi/reverse", env, { body: { lat: "abc", lng: 10 } })).status).toBe(400);
    expect((await call("POST", "/poi/reverse", env, { body: { lat: 10 } })).status).toBe(400);
  });

  it("rejects out-of-range lat/lng with 400", async () => {
    const env = makeEnv();
    expect((await call("POST", "/poi/reverse", env, { body: { lat: 95, lng: 0 } })).status).toBe(400);
    expect((await call("POST", "/poi/reverse", env, { body: { lat: 0, lng: 185 } })).status).toBe(400);
  });

  it("returns normalized POI and persists to D1 when cafe found", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJTEST123",
                formatted_address: "66 Mint St, San Francisco, CA",
                types: ["cafe", "point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJTEST123")) {
        return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const res = await call("POST", "/poi/reverse", env, {
      body: { lat: 37.7825, lng: -122.4077 },
      fetchImpl,
    });
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    expect(data.poi).toMatchObject({
      place_id: "ChIJTEST123",
      name: "Blue Bottle Coffee",
      source: "google",
      lat: 37.7825,
      lng: -122.4077,
    });

    const d1 = env.POI_DB as FakeD1;
    expect(d1.rows.map((r) => r.place_id)).toContain("ChIJTEST123");
  });

  it("invalidates the KV hot cache for the reverse-geocoded POI (BRAWUKA-332)", async () => {
    const kv = new FakeKV();
    await kv.put(
      "poi:ChIJTEST123",
      JSON.stringify(googleDetailResponse({ displayName: { text: "Stale Cafe Name" } })),
    );
    const env = makeEnv({ POI_KV: kv });
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJTEST123",
                types: ["cafe", "point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJTEST123")) {
        return new Response(
          JSON.stringify(googleDetailResponse({ displayName: { text: "Fresh Cafe Name" } })),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    const res = await call("POST", "/poi/reverse", env, {
      body: { lat: 37.7825, lng: -122.4077 },
      fetchImpl,
    });
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    expect(data.poi).toMatchObject({
      place_id: "ChIJTEST123",
      name: "Fresh Cafe Name",
    });

    // KV hot cache entry was invalidated
    expect(kv.has("poi:ChIJTEST123")).toBe(false);

    // Subsequent GET serves the fresh D1 row without calling Google API
    const getRes = await call("GET", "/poi/ChIJTEST123", env);
    expect(getRes.status).toBe(200);
    expect((await bodyOf(getRes)).name).toBe("Fresh Cafe Name");
  });

  it("returns { poi: null } when no food/cafe found", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 }),
    );

    const res = await call("POST", "/poi/reverse", env, {
      body: { lat: 37.7, lng: -122.4 },
      fetchImpl,
    });
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    expect(data).toEqual({ poi: null });
  });

  it("supports GET /poi/reverse?lat=...&lng=...", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJTEST123",
                formatted_address: "66 Mint St, San Francisco, CA",
                types: ["cafe", "point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJTEST123")) {
        return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const res = await call("GET", "/poi/reverse?lat=37.7825&lng=-122.4077", env, {
      fetchImpl,
    });
    expect(res.status).toBe(200);
    const data = await bodyOf(res);
    expect(data.poi).toMatchObject({
      place_id: "ChIJTEST123",
      name: "Blue Bottle Coffee",
    });
  });

  it("returns 502 upstream_error when upstream fails", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() => new Response("Internal Server Error", { status: 500 }));

    const res = await call("POST", "/poi/reverse", env, {
      body: { lat: 37.7, lng: -122.4 },
      fetchImpl,
    });
    expect(res.status).toBe(502);
    const data = await bodyOf(res);
    expect(data).toMatchObject({ error: "upstream_error" });
  });
});

describe("router", () => {
  it("404s unknown routes and wrong methods", async () => {
    expect((await call("GET", "/poi", makeEnv())).status).toBe(404);
    expect((await call("DELETE", "/poi/ChIJTEST123", makeEnv())).status).toBe(404);
    expect((await call("POST", "/poi/search", makeEnv())).status).toBe(404);
  });
});

describe("stableApplePlaceId parity (BRAWUKA-280)", () => {
  it("is deterministic and emits apple:hex ids", async () => {
    const { stableApplePlaceId } = await import("../../web/shared/places/apple-place-id");
    expect(stableApplePlaceId("1.3521,103.8198:Blue Bottle")).toMatch(/^apple:[0-9a-f]{8}$/);
    expect(stableApplePlaceId("1.3521,103.8198:Blue Bottle")).toBe(
      stableApplePlaceId("1.3521,103.8198:Blue Bottle"),
    );
    expect(stableApplePlaceId("a")).not.toBe(stableApplePlaceId("b"));
  });
});

describe("D1/KV cache expiry and cleanup (BRAWUKA-294)", () => {
  it("does not serve expired rows from D1 on getPOI", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "apple-expired-1",
      source: "apple",
      name: "Expired Apple Cafe",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("GET", "/poi/apple-expired-1", env);
    expect(res.status).toBe(404);
  });

  it("does not serve expired rows from D1 search", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "active-1",
      source: "google",
      name: "Active Cafe",
      lat: 1.3,
      lng: 103.8,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    db.rows.push({
      place_id: "expired-1",
      source: "google",
      name: "Expired Cafe",
      lat: 1.3,
      lng: 103.8,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("GET", "/poi/search?lat=1.3&lng=103.8", env);
    expect(res.status).toBe(200);
    const { results } = await bodyOf<{ results: Array<{ place_id: string }> }>(res);
    expect(results).toHaveLength(1);
    expect(results[0].place_id).toBe("active-1");
  });

  it("purges expired rows during upsert and sets expires_at to fetched_at + 30d", async () => {
    const db = new FakeD1();
    const kv = new FakeKV();
    db.rows.push({
      place_id: "to-be-purged",
      source: "google",
      name: "Old Expired",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db, POI_KV: kv });
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify(googleDetailResponse({ id: "ChIJNEW123" })), { status: 200 }),
    );
    const res = await call("GET", "/poi/ChIJNEW123", env, { fetchImpl });
    expect(res.status).toBe(200);
    // Expired row should be purged
    expect(db.rows.find((r) => r.place_id === "to-be-purged")).toBeUndefined();
    // Newly inserted row should have expires_at = fetched_at + 30d
    const inserted = db.rows.find((r) => r.place_id === "ChIJNEW123");
    expect(inserted).toBeDefined();
    const fetchedMs = Date.parse(inserted!.fetched_at as string);
    const expiresMs = Date.parse(inserted!.expires_at as string);
    expect(expiresMs - fetchedMs).toBe(30 * 24 * 3600 * 1000);
    expect(inserted).not.toHaveProperty("photo_refs");

    // KV has normalized POI under poi: prefix
    expect(kv.has("poi:ChIJNEW123")).toBe(true);
    expect(kv.has("raw:google:ChIJNEW123")).toBe(false);
    const cached = JSON.parse((await kv.get("poi:ChIJNEW123"))!);
    expect(cached).toMatchObject({
      place_id: "ChIJNEW123",
      source: "google",
      name: "Blue Bottle Coffee",
    });
    expect(cached).not.toHaveProperty("photos");
    expect(cached).not.toHaveProperty("photo_refs");
  });

  it("POST /poi/external writes expires_at = fetched_at + 30d and purges expired rows", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "expired-external",
      source: "apple",
      name: "Expired External",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("POST", "/poi/external", env, {
      body: {
        pois: [
          {
            place_id: "fresh-external-1",
            source: "apple",
            name: "Fresh External",
            lat: 1.3,
            lng: 103.8,
            types: ["cafe"],
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(db.rows.find((r) => r.place_id === "expired-external")).toBeUndefined();
    const stored = db.rows.find((r) => r.place_id === "fresh-external-1");
    expect(stored).toBeDefined();
    const fetchedMs = Date.parse(stored!.fetched_at as string);
    const expiresMs = Date.parse(stored!.expires_at as string);
    expect(expiresMs - fetchedMs).toBe(30 * 24 * 3600 * 1000);
  });

  it("does not serve rows expired earlier today (same-day ISO comparison parity)", async () => {
    const db = new FakeD1();
    db.rows.push({
      place_id: "same-day-expired",
      source: "apple",
      name: "Same Day Expired Cafe",
      lat: 1.0,
      lng: 103.0,
      address: null,
      types: '["cafe"]',
      business_status: null,
      hours_json: null,
      fetched_at: new Date(Date.now() - (30 * 24 * 3600 + 3600) * 1000).toISOString(),
      expires_at: new Date(Date.now() - 3600 * 1000).toISOString(), // expired 1 hour ago today
    });
    const env = makeEnv({ POI_DB: db });
    const res = await call("GET", "/poi/same-day-expired", env);
    expect(res.status).toBe(404);
  });
});
