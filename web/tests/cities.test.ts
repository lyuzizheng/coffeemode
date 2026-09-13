import { describe, expect, it } from "vitest";
import {
  DEFAULT_CITY,
  detectIpCity,
  findCity,
  findCityByCountry,
  LAUNCH_CITIES,
  nearestLaunchCity,
  resolveEffectiveCity,
} from "@/lib/cities";

describe("cities (DG50, DG128)", () => {
  it("contains the 10 launch cities with valid coordinates and timezones", () => {
    expect(LAUNCH_CITIES).toHaveLength(10);
    for (const city of LAUNCH_CITIES) {
      expect(city.id).toBeTruthy();
      expect(city.code).toMatch(/^[A-Z]{2}\/[A-Z]{3}$/);
      expect(city.center.lat).toBeGreaterThanOrEqual(-90);
      expect(city.center.lat).toBeLessThanOrEqual(90);
      expect(city.center.lng).toBeGreaterThanOrEqual(-180);
      expect(city.center.lng).toBeLessThanOrEqual(180);
      expect(city.tz).toBeTruthy();
    }
  });

  it("finds city by ID, name, code, or Chinese name", () => {
    expect(findCity("singapore")?.id).toBe("singapore");
    expect(findCity("Tokyo")?.id).toBe("tokyo");
    expect(findCity("JP/TYO")?.id).toBe("tokyo");
    expect(findCity("首尔")?.id).toBe("seoul");
    expect(findCity("kr-sel")?.id).toBe("seoul");
    expect(findCity("nonexistent")).toBeNull();
    expect(findCity("")).toBeNull();
    expect(findCity(null)).toBeNull();
  });

  it("finds city by ISO country code (findCityByCountry)", () => {
    expect(findCityByCountry("SG")?.id).toBe("singapore");
    expect(findCityByCountry("jp")?.id).toBe("tokyo");
    expect(findCityByCountry("KR")?.id).toBe("seoul");
    expect(findCityByCountry("FR")).toBeNull();
    expect(findCityByCountry("")).toBeNull();
    expect(findCityByCountry(null)).toBeNull();
  });

  it("resolves effective city across explicit, cf-ipcity, cf-ipcountry, and default (resolveEffectiveCity)", () => {
    // 1. Explicit city wins if valid
    const headersEmpty = new Headers();
    expect(resolveEffectiveCity(headersEmpty, "tokyo")).toBe("tokyo");
    expect(resolveEffectiveCity(headersEmpty, "JP/TYO")).toBe("tokyo");

    // 2. CF-IPCity header resolves when explicit city omitted
    const headersCity = new Headers({ "cf-ipcity": "Tokyo" });
    expect(resolveEffectiveCity(headersCity)).toBe("tokyo");

    // 3. CF-IPCountry fallback when CF-IPCity misses
    const headersCountry = new Headers({ "cf-ipcity": "UnknownCity", "cf-ipcountry": "SG" });
    expect(resolveEffectiveCity(headersCountry)).toBe("singapore");

    // 4. Default city when neither header matches
    const headersNone = new Headers({ "cf-ipcity": "UnknownCity", "cf-ipcountry": "ZZ" });
    expect(resolveEffectiveCity(headersNone)).toBe("singapore");
    expect(resolveEffectiveCity(headersEmpty)).toBe("singapore");
  });

  it("defaults to Singapore", () => {
    expect(DEFAULT_CITY.id).toBe("singapore");
    expect(DEFAULT_CITY.code).toBe("SG/SIN");
  });

  it("detects the IP city for the welcome card (detectIpCity, DG128)", () => {
    expect(detectIpCity(new Headers({ "cf-ipcity": "Tokyo" }))?.id).toBe("tokyo");
    expect(
      detectIpCity(new Headers({ "cf-ipcity": "Nowhere", "cf-ipcountry": "KR" }))?.id,
    ).toBe("seoul");
    expect(detectIpCity(new Headers({ "cf-ipcity": "Nowhere", "cf-ipcountry": "FR" }))).toBeNull();
    expect(detectIpCity(new Headers())).toBeNull();
  });

  it("resolves the nearest launch city inside coverage, null beyond it (DG121)", () => {
    // ~10 km from Singapore center → in coverage.
    expect(nearestLaunchCity(1.29, 103.85, 50)?.id).toBe("singapore");
    // Johor Bahru is closer to Singapore than to any other launch city.
    expect(nearestLaunchCity(1.49, 103.74, 50)?.id).toBe("singapore");
    // Lisbon: outside every launch city's 50 km radius.
    expect(nearestLaunchCity(38.72, -9.14, 50)).toBeNull();
    // A wider radius still picks the nearest city, not the first match.
    expect(nearestLaunchCity(48.85, 2.35, 600)?.id).toBe("london");
  });
});
