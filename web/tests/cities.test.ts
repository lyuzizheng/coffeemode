import { describe, expect, it } from "vitest";
import { DEFAULT_CITY, findCity, LAUNCH_CITIES } from "@/lib/cities";

describe("cities (DG50)", () => {
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

  it("defaults to Singapore", () => {
    expect(DEFAULT_CITY.id).toBe("singapore");
    expect(DEFAULT_CITY.code).toBe("SG/SIN");
  });
});
