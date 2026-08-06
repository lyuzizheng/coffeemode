import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPOI, getPOIConfig, resolveMapsUrl, searchPOIs } from "@/lib/places/poi-client";
import { GET as searchGET } from "@/app/api/places/search/route";
import { POST as resolvePOST } from "@/app/api/places/resolve/route";

const WORKER_URL = "https://poi-service.test.workers.dev";
const TOKEN = "s3cret-token";

const SAMPLE_POI = {
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
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
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

  it("defaults radius to 50 and passes coords-only queries", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await searchGET(new Request(`${WORKER_URL}/api/places/search?lat=1.3&lng=103.8`));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${WORKER_URL}/poi/search?lat=1.3&lng=103.8&r=50`);
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

  it("maps worker 422 (unresolvable) through", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unresolvable" }, 422));
    const res = await resolvePOST(
      new Request(`${WORKER_URL}/api/places/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: "https://example.com/nope" }),
      }),
    );
    expect(res.status).toBe(422);
  });
});