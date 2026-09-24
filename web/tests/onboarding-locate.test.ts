import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { resolveLocatedCity } from "@/lib/onboarding";
import { displayCityName, findCity } from "@/lib/cities";
import { resolveSearchScope } from "@/lib/search/search-client";
import { POST as locateRoute } from "@/app/api/onboarding/locate/route";
import { apiClient } from "./helpers/http-client";

describe("onboarding locate and runtime city resolution (BRAWUKA-695)", () => {
  it("resolves inside launch coverage to nearest launch city", () => {
    // Singapore center
    const res = resolveLocatedCity(1.3521, 103.8198);
    expect(res.inCoverage).toBe(true);
    expect(res.city).not.toBeNull();
    expect(res.city?.id).toBe("singapore");
    expect(res.city?.runtime).toBe(false);
    expect(res.city?.name).toBe("Singapore");
    expect(res.city?.nameZh).toBe("新加坡");
    expect(findCity(res.city?.id)?.id).toBe("singapore");
  });

  it("resolves outside launch coverage to rt-<zone> with honest country names", () => {
    // Urumqi: outside coverage of all launch cities (Asia/Urumqi)
    const urumqi = resolveLocatedCity(43.8256, 87.6168);
    expect(urumqi.inCoverage).toBe(false);
    expect(urumqi.city).not.toBeNull();
    expect(urumqi.city?.id).toBe("rt-asia-urumqi");
    expect(urumqi.city?.runtime).toBe(true);
    expect(urumqi.city?.name).toBe("China");
    expect(urumqi.city?.nameZh).toBe("中国");
    expect(urumqi.city?.tz).toBe("Asia/Urumqi");
    // Invariant: runtime id must not collide with launch cities
    expect(findCity(urumqi.city?.id)).toBeNull();

    // Munich: Europe/Berlin zone, >50km from Berlin center
    const munich = resolveLocatedCity(48.1351, 11.582);
    expect(munich.inCoverage).toBe(false);
    expect(munich.city).not.toBeNull();
    expect(munich.city?.id).toBe("rt-europe-berlin");
    expect(munich.city?.runtime).toBe(true);
    expect(munich.city?.name).toBe("Germany");
    expect(munich.city?.nameZh).toBe("德国");
    // Must NOT be branded as Berlin launch city
    expect(findCity(munich.city?.id)).toBeNull();

    // Lisbon: Europe/Lisbon
    const lisbon = resolveLocatedCity(38.7223, -9.1393);
    expect(lisbon.inCoverage).toBe(false);
    expect(lisbon.city?.id).toBe("rt-europe-lisbon");
    expect(lisbon.city?.name).toBe("Portugal");
    expect(lisbon.city?.nameZh).toBe("葡萄牙");

    // Buenos Aires: America/Argentina/Buenos_Aires (preserves internal underscores)
    const ba = resolveLocatedCity(-34.6037, -58.3816);
    expect(ba.inCoverage).toBe(false);
    expect(ba.city?.id).toBe("rt-america-argentina-buenos_aires");
    expect(ba.city?.name).toBe("Argentina");
    expect(ba.city?.nameZh).toBe("阿根廷");
  });

  it("returns { inCoverage: false, city: null } for Etc/* and unresolvable ocean coordinates", () => {
    // Gulf of Guinea (0, 0) falls in Etc/GMT
    const ocean = resolveLocatedCity(0, 0);
    expect(ocean.inCoverage).toBe(false);
    expect(ocean.city).toBeNull();

    // Coordinates out of bounds
    const invalid = resolveLocatedCity(999, 999);
    expect(invalid.inCoverage).toBe(false);
    expect(invalid.city).toBeNull();
  });

  describe("displayCityName", () => {
    it("renders launch cities localized", () => {
      expect(displayCityName("shanghai", "en")).toBe("Shanghai");
      expect(displayCityName("shanghai", "zh")).toBe("上海");
      expect(displayCityName("hongkong", "en")).toBe("Hong Kong");
      expect(displayCityName("hongkong", "zh")).toBe("香港");
    });

    it("renders rt-* runtime city ids as localized country names", () => {
      expect(displayCityName("rt-asia-shanghai", "en")).toBe("China");
      expect(displayCityName("rt-asia-shanghai", "zh")).toBe("中国");
      expect(displayCityName("rt-asia-urumqi", "zh")).toBe("中国");
      expect(displayCityName("rt-europe-berlin", "en")).toBe("Germany");
      expect(displayCityName("rt-europe-berlin", "zh")).toBe("德国");
      expect(displayCityName("rt-america-argentina-buenos_aires", "zh")).toBe("阿根廷");
      expect(displayCityName("rt-america-sao_paulo", "en")).toBe("Brazil");
    });

    it("prefers the persisted locality name for rt-* ids, never for launch ids (BRAWUKA-696)", () => {
      // Precise name replaces the country fallback for runtime cities.
      expect(displayCityName("rt-asia-urumqi", "zh", "乌鲁木齐")).toBe("乌鲁木齐");
      expect(displayCityName("rt-asia-urumqi", "en", "Ürümqi")).toBe("Ürümqi");
      // Null/absent name keeps the country fallback.
      expect(displayCityName("rt-asia-urumqi", "zh", null)).toBe("中国");
      // Launch ids ignore the display-only field entirely — findCity owns them.
      expect(displayCityName("shanghai", "en", "Forged Name")).toBe("Shanghai");
      expect(displayCityName("shanghai", "zh", "伪造名")).toBe("上海");
      // Non-runtime unknown ids never consult the name either.
      expect(displayCityName("random-town", "en", "Forged")).toBe("Random-town");
    });

    it("handles empty and unknown values gracefully", () => {
      expect(displayCityName(null, "en")).toBe("");
      expect(displayCityName(undefined, "zh")).toBe("");
      expect(displayCityName("", "en")).toBe("");
      // Unknown values pass through capitalized
      expect(displayCityName("random-town", "en")).toBe("Random-town");
    });
  });

  describe("resolveSearchScope", () => {
    it("routes launch cities to city scope and rt-* runtime cities to coordinate scope", () => {
      // Launch city: uses city scope
      const launchScope = resolveSearchScope("shanghai", 43.8256, 87.6168);
      expect(launchScope.city).toBe("shanghai");

      // Runtime city: does NOT match launch city, routes to caller coordinates
      const runtimeScope = resolveSearchScope("rt-asia-shanghai", 43.8256, 87.6168);
      expect(runtimeScope.city).toBeUndefined();
      expect(runtimeScope.lat).toBe(43.8256);
      expect(runtimeScope.lng).toBe(87.6168);
    });
  });

  describe("POST /api/onboarding/locate route", () => {
    it("resolves anonymous geolocation without writing profile", async () => {
      const client = apiClient(null);
      const res = await client.post<{
        inCoverage: boolean;
        city: { id: string; name: string; nameZh: string; runtime: boolean } | null;
      }>(locateRoute, "/api/onboarding/locate", {
        lat: 43.8256,
        lng: 87.6168,
      });

      expect(res.status).toBe(200);
      expect(res.data.inCoverage).toBe(false);
      expect(res.data.city?.id).toBe("rt-asia-urumqi");
      expect(res.data.city?.name).toBe("China");
      expect(res.data.city?.nameZh).toBe("中国");
      expect(res.data.city?.runtime).toBe(true);
    });

    it("returns null city for ocean coordinates", async () => {
      const client = apiClient(null);
      const res = await client.post<{
        inCoverage: boolean;
        city: null;
      }>(locateRoute, "/api/onboarding/locate", {
        lat: 0,
        lng: 0,
      });

      expect(res.status).toBe(200);
      expect(res.data.inCoverage).toBe(false);
      expect(res.data.city).toBeNull();
    });
  });
});
