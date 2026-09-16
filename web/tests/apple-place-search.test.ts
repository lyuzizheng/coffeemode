/**
 * @vitest-environment jsdom
 * Apple provider session-expiry contract (BRAWUKA-296).
 *
 * `GET /api/mapkit-token` is auth-gated, so a dead session on the token
 * fetch must surface as the shared `unauthorized` marker — the same signal
 * the creation drawer routes to its sign-in gate (BRAWUKA-212) — not as a
 * "not configured" error. `window.mapkit` is stubbed; only the token fetch
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applePlaceSearch } from "@/lib/places/apple-place-search";
import type { CreateTranslator } from "@/lib/places/place-search";
import { isUnauthorized } from "@/lib/http";

// Test-only translator stub: providers only call `t(key)` for labels.
const stubTranslator = ((key: string) => key) as unknown as CreateTranslator;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("applePlaceSearch init (BRAWUKA-296)", () => {
  it("rejects with the unauthorized marker when the token fetch is 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })),
    );
    await expect(applePlaceSearch(stubTranslator).init?.()).rejects.toSatisfy(isUnauthorized);
  });

  it("rejects with a not-configured error when the token fetch fails otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"mapkit_not_configured"}', { status: 503 })),
    );
    await expect(applePlaceSearch(stubTranslator).init?.()).rejects.toThrow("MapKit is not configured");
  });
});
