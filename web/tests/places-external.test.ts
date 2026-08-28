import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POI } from "@shared/places/types";

const { getCurrentUserMock, storeExternalPOIsMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  storeExternalPOIsMock: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/places/poi-client", () => ({
  POIServiceError: class POIServiceError extends Error {
    status = 500;
  },
  storeExternalPOIs: storeExternalPOIsMock,
}));

import { POST } from "@/app/api/places/external/route";

const USER = { id: "550e8400-e29b-41d4-a716-446655440000" };
const APPLE_POI: POI = {
  place_id: "apple-place-opaque-ref",
  source: "apple",
  name: "Coffee Mode",
  lat: 1.3,
  lng: 103.8,
  address: "Singapore",
  types: ["cafe"],
  business_status: null,
  hours_json: null,
  photo_refs: [],
  fetched_at: new Date(0).toISOString(),
};

const GOOGLE_POI: POI = { ...APPLE_POI, place_id: "ChIJgoogle", source: "google" };

function request(pois: unknown[]): Request {
  return new Request("https://coffee.test/api/places/external", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pois }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(USER);
  storeExternalPOIsMock.mockResolvedValue({ stored: 1 });
});

describe("POST /api/places/external", () => {
  it("rejects browser-submitted Google records before touching the worker", async () => {
    const response = await POST(request([GOOGLE_POI]));

    expect(response.status).toBe(400);
    expect(storeExternalPOIsMock).not.toHaveBeenCalled();
  });

  it("persists Apple MapKit records", async () => {
    const response = await POST(request([APPLE_POI]));

    expect(response.status).toBe(200);
    expect(storeExternalPOIsMock).toHaveBeenCalledWith([APPLE_POI]);
  });

  it("rejects batch sizes exceeding MAX_EXTERNAL_BATCH_SIZE (50)", async () => {
    const oversized = Array.from({ length: 51 }, (_, i) => ({
      ...APPLE_POI,
      place_id: `apple-place-${i}`,
    }));
    const response = await POST(request(oversized));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
    expect(body.message).toBe("pois array must contain at most 50 items");
    expect(storeExternalPOIsMock).not.toHaveBeenCalled();
  });
});
