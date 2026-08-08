import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import sharp from "sharp";
import { processImage } from "@/lib/images/processor";
import type { ProcessUrls } from "@/lib/images/image-service-client";

function makeProcessUrls(imageUuid: string): ProcessUrls {
  return {
    imageUuid,
    original: {
      url: `https://r2.example.com/original/${imageUuid}.webp?sig=get`,
      headers: {},
    },
    originalPut: {
      url: `https://r2.example.com/original/${imageUuid}.webp?sig=put`,
      headers: { "Content-Type": "image/webp" },
    },
    card: {
      url: `https://r2.example.com/card/${imageUuid}.webp?sig=put`,
      headers: { "Content-Type": "image/webp" },
    },
    thumbnail: {
      url: `https://r2.example.com/thumbnail/${imageUuid}.webp?sig=put`,
      headers: { "Content-Type": "image/webp" },
    },
    publicUrls: {
      original: `https://images.coffeemode.app/original/${imageUuid}.webp`,
      card: `https://images.coffeemode.app/card/${imageUuid}.webp`,
      thumbnail: `https://images.coffeemode.app/thumbnail/${imageUuid}.webp`,
    },
    keys: {
      original: `original/${imageUuid}.webp`,
      card: `card/${imageUuid}.webp`,
      thumbnail: `thumbnail/${imageUuid}.webp`,
    },
  };
}

describe("processImage", () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the original, resizes to three variants, and uploads them", async () => {
    const imageUuid = "12345678-1234-4123-9234-123456789abc";
    const originalBuffer = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .webp({ quality: 80 })
      .toBuffer();

    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("?sig=get")) {
        return new Response(originalBuffer, { status: 200, headers: { "Content-Type": "image/webp" } });
      }
      if (init?.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const urls = makeProcessUrls(imageUuid);
    const result = await processImage(imageUuid, urls);

    expect(result.imageUuid).toBe(imageUuid);
    expect(result.publicUrls).toEqual(urls.publicUrls);
    expect(result.width).toBeLessThanOrEqual(100);
    expect(result.height).toBeLessThanOrEqual(80);

    const putCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(putCalls).toHaveLength(3);
    expect(putCalls[0][0].toString()).toContain("original");
    expect(putCalls[1][0].toString()).toContain("card");
    expect(putCalls[2][0].toString()).toContain("thumbnail");
  });

  it("throws when the original download fails", async () => {
    const imageUuid = "12345678-1234-4123-9234-123456789abc";
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(processImage(imageUuid, makeProcessUrls(imageUuid))).rejects.toThrow("failed to download original image");
  });

  it("throws when a PUT upload fails", async () => {
    const imageUuid = "12345678-1234-4123-9234-123456789abc";
    const originalBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .webp()
      .toBuffer();

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("?sig=get")) {
        return new Response(originalBuffer, { status: 200 });
      }
      if (url.includes("card")) {
        return new Response("bad request", { status: 400 });
      }
      return new Response(null, { status: 200 });
    });

    await expect(processImage(imageUuid, makeProcessUrls(imageUuid))).rejects.toThrow("failed to upload image variant");
  });
});
