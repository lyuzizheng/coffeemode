import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PASSTHROUGH_STATUSES,
  isPassthroughStatus,
  sanitizePassthroughStatus,
} from "@shared/errors";
import {
  ImageServiceError,
  requestUploadUrl,
} from "@/lib/images/image-service-client";
import {
  POIServiceError,
  getPOI,
} from "@/lib/places/poi-client";
import { GET as placesDetailsGET } from "@/app/api/places/details/route";
import { POST as imagesUploadPOST } from "@/app/api/images/upload/route";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "test-user-id" }),
}));

vi.mock("@/lib/db/image-uploads", () => ({
  recordUploadIntent: vi.fn().mockResolvedValue(undefined),
}));

describe("Upstream 4xx/5xx passthrough status sanitization (BRAWUKA-596)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.IMAGE_SERVICE_URL = "https://images.example.workers.dev";
    process.env.IMAGE_SERVICE_TOKEN = "test-image-token";
    process.env.POI_SERVICE_URL = "https://poi.example.workers.dev";
    process.env.POI_SERVICE_TOKEN = "test-poi-token";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe("sanitizePassthroughStatus registry helper", () => {
    it("defines PASSTHROUGH_STATUSES as exactly [404, 413, 422]", () => {
      expect(PASSTHROUGH_STATUSES).toEqual([404, 413, 422]);
    });

    it("identifies registered passthrough statuses correctly", () => {
      expect(isPassthroughStatus(404)).toBe(true);
      expect(isPassthroughStatus(413)).toBe(true);
      expect(isPassthroughStatus(422)).toBe(true);

      expect(isPassthroughStatus(400)).toBe(false);
      expect(isPassthroughStatus(401)).toBe(false);
      expect(isPassthroughStatus(403)).toBe(false);
      expect(isPassthroughStatus(429)).toBe(false);
      expect(isPassthroughStatus(500)).toBe(false);
      expect(isPassthroughStatus(502)).toBe(false);
    });

    it("clamps unmirrored statuses to 502 and preserves registered set", () => {
      expect(sanitizePassthroughStatus(404)).toBe(404);
      expect(sanitizePassthroughStatus(413)).toBe(413);
      expect(sanitizePassthroughStatus(422)).toBe(422);

      expect(sanitizePassthroughStatus(400)).toBe(502);
      expect(sanitizePassthroughStatus(401)).toBe(502);
      expect(sanitizePassthroughStatus(403)).toBe(502);
      expect(sanitizePassthroughStatus(429)).toBe(502);
      expect(sanitizePassthroughStatus(500)).toBe(502);
      expect(sanitizePassthroughStatus(503)).toBe(502);
    });
  });

  describe("ImageServiceClient upstream status sanitization", () => {
    it.each([
      [429, 502, "Image service unavailable"],
      [400, 502, "Image service unavailable"],
      [401, 502, "Image service unavailable"],
      [403, 502, "Image service unavailable"],
      [500, 502, "Image service unavailable"],
      [502, 502, "Image service unavailable"],
      [404, 404, "Image not found"],
      [413, 413, "Image rejected by the image service"],
      [422, 422, "Image rejected by the image service"],
    ])(
      "maps upstream %i to status %i with message '%s' and keeps upstreamStatus",
      async (upstreamStatus, expectedStatus, expectedMessage) => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response("worker error body", { status: upstreamStatus }),
        );

        try {
          await requestUploadUrl(1024, "req-test-1");
          expect.fail("should have thrown ImageServiceError");
        } catch (err) {
          expect(err).toBeInstanceOf(ImageServiceError);
          const serviceErr = err as ImageServiceError;
          expect(serviceErr.status).toBe(expectedStatus);
          expect(serviceErr.upstreamStatus).toBe(upstreamStatus);
          expect(serviceErr.message).toBe(expectedMessage);
        }
      },
    );
  });

  describe("POIClient upstream status sanitization", () => {
    it.each([
      [429, 502, "POI service unavailable"],
      [400, 502, "POI service unavailable"],
      [401, 502, "POI service unavailable"],
      [403, 502, "POI service unavailable"],
      [500, 502, "POI service unavailable"],
      [502, 502, "POI service unavailable"],
      [404, 404, "POI not found"],
      [413, 413, "POI request payload too large"],
      [422, 422, "POI could not be resolved"],
    ])(
      "maps upstream %i to status %i with message '%s' and keeps upstreamStatus",
      async (upstreamStatus, expectedStatus, expectedMessage) => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response("worker error body", { status: upstreamStatus }),
        );

        try {
          await getPOI("place-123", undefined, "req-test-2");
          expect.fail("should have thrown POIServiceError");
        } catch (err) {
          expect(err).toBeInstanceOf(POIServiceError);
          const serviceErr = err as POIServiceError;
          expect(serviceErr.status).toBe(expectedStatus);
          expect(serviceErr.upstreamStatus).toBe(upstreamStatus);
          expect(serviceErr.message).toBe(expectedMessage);
        }
      },
    );
  });

  describe("Route envelope verification", () => {
    it("fake upstream 429 on POI worker produces route envelope poi_service with status 502, not 429", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("upstream rate limit", { status: 429 }),
      );

      const requestId = crypto.randomUUID();
      const req = new Request("http://localhost/api/places/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4", {
        headers: { "x-request-id": requestId },
      });
      const res = await placesDetailsGET(req);

      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBeNull();
      const body = await res.json();
      expect(body.error).toBe("poi_service");
      expect(body.message).toBe("POI service unavailable");
      expect(body.request_id).toBe(requestId);
    });

    it("fake upstream 400 on POI worker produces route envelope poi_service with status 502, not 400", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("upstream bad request", { status: 400 }),
      );

      const requestId = crypto.randomUUID();
      const req = new Request("http://localhost/api/places/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4", {
        headers: { "x-request-id": requestId },
      });
      const res = await placesDetailsGET(req);

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("poi_service");
      expect(body.message).toBe("POI service unavailable");
      expect(body.request_id).toBe(requestId);
    });

    it("fake upstream 404 on POI worker passes through as 404 poi_service", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("not found", { status: 404 }),
      );

      const req = new Request("http://localhost/api/places/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4", {
        headers: { "x-request-id": crypto.randomUUID() },
      });
      const res = await placesDetailsGET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("poi_service");
      expect(body.message).toBe("POI not found");
    });

    it("fake upstream 429 on image service produces route envelope image_service_error with status 502, not 429", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("upstream rate limit", { status: 429 }),
      );

      const requestId = crypto.randomUUID();
      const req = new Request("http://localhost/api/images/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ size: 2048 }),
      });
      const res = await imagesUploadPOST(req);

      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBeNull();
      const body = await res.json();
      expect(body.error).toBe("image_service_error");
      expect(body.message).toBe("Image service unavailable");
      expect(body.request_id).toBe(requestId);
    });

    it("fake upstream 400 on image service produces route envelope image_service_error with status 502, not 400", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("upstream bad request", { status: 400 }),
      );

      const requestId = crypto.randomUUID();
      const req = new Request("http://localhost/api/images/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ size: 2048 }),
      });
      const res = await imagesUploadPOST(req);

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("image_service_error");
      expect(body.message).toBe("Image service unavailable");
      expect(body.request_id).toBe(requestId);
    });

    it("fake upstream 413 on image service passes through as 413 image_service_error", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("payload too large", { status: 413 }),
      );

      const req = new Request("http://localhost/api/images/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "x-request-id": "req-img-413",
        },
        body: JSON.stringify({ size: 2048 }),
      });
      const res = await imagesUploadPOST(req);

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toBe("image_service_error");
      expect(body.message).toBe("Image rejected by the image service");
    });
  });
});
