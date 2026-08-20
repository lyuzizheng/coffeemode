import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPOI,
  getPOIConfig,
  resolveMapsUrl,
  searchExternalPOIs,
  searchPOIs,
  storeExternalPOIs,
} from "@/lib/places/poi-client";
import { GET as searchGET } from "@/app/api/places/search/route";
import { POST as resolvePOST } from "@/app/api/places/resolve/route";
import type { POI } from "@shared/places/types";

const { getCurrentUserMock } = vi.hoisted(() => ({ getCurrentUserMock: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: getCurrentUserMock }));

const WORKER_URL = "https://poi-service.test.workers.dev";
const TOKEN = "s3cret-token";

const SAMPLE_POI: POI = {
  place_id: "ChIJTEST123",
  source: "google",
  name: "Blue Bottle Coffee",
  lat: 37.7825,
  lng: -122.4077,
  address: "66 Mint St",
  types: ["cafe"],
  business_status: "OPERATIONAL",
  hours_json: null,
  photo_refs: ["places/ChIJTEST123/photos/p1"],
  fetched_at: "2026-08-06T00:00:00.000Z",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.POI_SERVICE_URL = WORKER_URL;
  process.env.POI_SERVICE_TOKEN = TOKEN;
  getCurrentUserMock.mockResolvedValue(null);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.POI_SERVICE_URL;
  delete process.env.POI_SERVICE_TOKEN;
  vi.unstubAllGlobals();
});

describe("getPOIConfig", () => {
  it("normalizes trailing slashes and requires both env vars", () => {
    expect(getPOIConfig({ POI_SERVICE_URL: `${WORKER_URL}/`, POI_SERVICE_TOKEN: TOKEN })).toEqual({
      baseUrl: WORKER_URL,
      token: TOKEN,
    });
    expect(getPOIConfig({ POI_SERVICE_URL: WORKER_URL })).toBeNull();
    expect(getPOIConfig({ POI_SERVICE_TOKEN: TOKEN })).toBeNull();
  });
});

describe("poi-client", () => {
  it("searchPOIs hits /poi/search with token header and query params", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ ...SAMPLE_POI, distance_km: 0.4 }] }));

    const data = await searchPOIs({ q: "blue", lat: 37.7, lng: -122.4, r: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/search?q=blue&lat=37.7&lng=-122.4&r=10`);
    expect(init.headers).toMatchObject({ "x-poi-service-token": TOKEN });
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(data.results[0].place_id).toBe("ChIJTEST123");
  });

  it("searchPOIs omits empty params", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await searchPOIs({});
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search`);
  });

  it("searchExternalPOIs uses the live Google search endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [SAMPLE_POI] }));
    await searchExternalPOIs({ q: "blue bottle", r: 5 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search/external?q=blue+bottle&r=5`);
  });

  it("storeExternalPOIs posts browser-provider results", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ stored: 1 }));
    await storeExternalPOIs([SAMPLE_POI]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/external`);
    expect(JSON.parse(String(init.body))).toEqual({ pois: [SAMPLE_POI] });
  });

  it("resolveMapsUrl POSTs the share URL to /poi/resolve", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_POI));
    const poi = await resolveMapsUrl("https://maps.app.goo.gl/abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/resolve`);
    expect(JSON.parse(String(init.body))).toEqual({
      maps_share_url: "https://maps.app.goo.gl/abc",
    });
    expect(init.headers).toMatchObject({ "x-poi-service-token": TOKEN });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(poi.name).toBe("Blue Bottle Coffee");
  });

  it("getPOI fetches /poi/:place_id and preserves colons", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_POI));
    const poi = await getPOI("0x8085abc:0x1234def");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/0x8085abc:0x1234def`);
    expect(init.headers).toMatchObject({ "x-poi-service-token": TOKEN });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(poi.name).toBe("Blue Bottle Coffee");
  });

  it("throws 503 when not configured", async () => {
    delete process.env.POI_SERVICE_URL;
    await expect(searchPOIs({ q: "x" })).rejects.toMatchObject({
      name: "POIServiceError",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a worker 401 to 502 (upstream auth failure)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    await expect(searchPOIs({ q: "x" })).rejects.toMatchObject({
      name: "POIServiceError",
      status: 502,
      upstreamStatus: 401,
    });
  });

  it("does not log upstream error response bodies", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ internal: "stack trace" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(searchPOIs({ q: "x" })).rejects.toMatchObject({
      name: "POIServiceError",
      status: 500,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, logged] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(logged).toEqual(
      expect.objectContaining({
        status: 500,
        message: "POI service unavailable",
      }),
    );
    expect(logged).not.toHaveProperty("body");
    errorSpy.mockRestore();
  });

  it("cancels the upstream response body instead of buffering it", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      body: { cancel: cancelSpy },
    } as unknown as Response);

    await expect(searchPOIs({ q: "x" })).rejects.toMatchObject({
      name: "POIServiceError",
      status: 502,
    });

    expect(cancelSpy).toHaveBeenCalledOnce();
  });
});

describe("GET /api/places/search", () => {
  it("proxies a valid search through the worker", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ ...SAMPLE_POI, distance_km: 1.2 }] }));

    const res = await searchGET(
      new Request(`${WORKER_URL}/api/places/search?q=blue&lat=37.7&lng=-122.4&r=5`),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/search?q=blue&lat=37.7&lng=-122.4&r=5`);
    expect(init.headers).toMatchObject({ "x-poi-service-token": TOKEN });
  });

  it("defaults radius to 10 and passes coords-only queries", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await searchGET(new Request(`${WORKER_URL}/api/places/search?lat=1.3&lng=103.8`));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search?lat=1.3&lng=103.8&r=10`);
  });

  it("routes source=google to live external search", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    const res = await searchGET(
      new Request(`${WORKER_URL}/api/places/search?source=google&q=blue%20bottle`),
    );
    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search/external?q=blue+bottle&r=10`);
  });

  it("rejects anonymous live Google search before touching the worker", async () => {
    const res = await searchGET(
      new Request(`${WORKER_URL}/api/places/search?source=google&q=blue%20bottle`),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported provider sources", async () => {
    const res = await searchGET(
      new Request(`${WORKER_URL}/api/places/search?source=apple&q=coffee`),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clamps radius to 10 km", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await searchGET(new Request(`${WORKER_URL}/api/places/search?lat=1.3&lng=103.8&r=20`));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search?lat=1.3&lng=103.8&r=10`);
  });

  it("400s without q or coordinates", async () => {
    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search`));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s on invalid radius", async () => {
    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search?q=x&r=abc`));
    expect(res.status).toBe(400);
  });

  it.each([
    ["lat", "q=x&lat=37.7junk&lng=-122.4"],
    ["lng", "q=x&lat=37.7&lng=-122.4junk"],
    ["r", "q=x&r=5km"],
  ])("400s without calling the worker for trailing junk in %s", async (_param, query) => {
    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search?${query}`));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps worker errors to the same status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 502));
    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search?q=x`));
    expect(res.status).toBe(502);
    expect((await res.json()) as { error: string }).toEqual({ error: "poi_service", message: expect.stringContaining("unavailable") });
  });

  it("503s when the worker env is missing", async () => {
    delete process.env.POI_SERVICE_URL;
    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search?q=x`));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/places/resolve", () => {
  it("proxies a maps share URL to the worker", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_POI));

    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "https://maps.app.goo.gl/xyz" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe("Blue Bottle Coffee");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/poi/resolve`);
    expect(JSON.parse(String(init.body))).toEqual({
      maps_share_url: "https://maps.app.goo.gl/xyz",
    });
  });

  it("400s without maps_share_url", async () => {
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps worker 422 (unresolvable) through for allowed hosts", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unresolvable" }, 422));
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "https://maps.app.goo.gl/nope" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("400s for disallowed maps_share_url domains", async () => {
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "https://example.com/nope" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_maps_url",
      message: expect.stringContaining("Google Maps and Apple Maps"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s for http URLs, non-map google subdomains, and lookalikes (issue #37)", async () => {
    for (const maps_share_url of [
      "http://www.google.com/maps/place/foo",
      "https://drive.google.com/file/d/x",
      "https://m.google.com/maps",
      "https://google.com.evil.com/maps",
      "https://google.evil.io/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c",
    ]) {
      const res = await resolvePOST(
        new Request(`${WORKER_URL}/api/places/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maps_share_url }),
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s for malformed maps_share_url", async () => {
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "not-a-url" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_maps_url",
      message: expect.stringContaining("Google Maps and Apple Maps"),
    });
  });

  it("allows Google Maps subdomains", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_POI));
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "https://www.google.com/maps/place/foo" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});
