import { describe, expect, it } from "vitest";

import { parseProfilePatch } from "@/lib/validation/profile";

/**
 * currentCityName (BRAWUKA-696): the display-only runtime-city name the client
 * reverse-geocodes via MapKit JS. `null` clears; strings are stripped of
 * control/format/separator characters and bounded by
 * `validation.profileCityNameMaxChars` (80).
 */
describe("parseProfilePatch currentCityName", () => {
  it("accepts a bounded locality name", () => {
    const res = parseProfilePatch({ currentCityName: "Ürümqi" });
    expect(res).toEqual({ ok: true, patch: { currentCityName: "Ürümqi" } });
  });

  it("treats null as an explicit clear", () => {
    const res = parseProfilePatch({ currentCityName: null });
    expect(res).toEqual({ ok: true, patch: { currentCityName: null } });
  });

  it("strips control, format, and separator characters", () => {
    const res = parseProfilePatch({ currentCityName: "  São\u200B Paulo\u2028\n" });
    expect(res).toEqual({ ok: true, patch: { currentCityName: "São Paulo" } });
  });

  it("rejects empty-after-clean, over-length, and non-string values", () => {
    for (const currentCityName of ["", "   ", "\u200B", "x".repeat(81), 5, {}]) {
      const res = parseProfilePatch({ currentCityName });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("invalid_current_city_name");
    }
  });

  it("combines with other patch fields", () => {
    const res = parseProfilePatch({
      currentCity: "rt-asia-urumqi",
      currentCityName: "乌鲁木齐",
      lastLocation: { lat: 43.8256, lng: 87.6168 },
    });
    expect(res).toEqual({
      ok: true,
      patch: {
        currentCity: "rt-asia-urumqi",
        currentCityName: "乌鲁木齐",
        lastLocation: { lat: 43.8256, lng: 87.6168 },
      },
    });
  });
});
