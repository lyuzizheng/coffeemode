import { afterEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/lib/config";
import {
  getMapLibreTileStyleDark,
  getMapLibreTileStyleLight,
  mapLibreStyleForTheme,
} from "@/components/map/maplibre-config";

// MapLibre provider config (BRAWUKA-329): `map.maplibre` values reach the
// browser via NEXT_PUBLIC_MAPLIBRE_* in next.config.ts; the fallbacks mirror
// the same YAML values so dev/test behave identically — pinned against
// `appConfig` so drift fails fast.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("maplibre provider config", () => {
  it("falls back to the YAML-owned style URLs without env", () => {
    expect(getMapLibreTileStyleLight()).toBe(appConfig.map.maplibre.tileStyle.light);
    expect(getMapLibreTileStyleDark()).toBe(appConfig.map.maplibre.tileStyle.dark);
  });

  it("honors env overrides from next.config.ts", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_DARK", "https://tiles.example.com/dark.json");
    expect(getMapLibreTileStyleDark()).toBe("https://tiles.example.com/dark.json");
    vi.stubEnv("NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_LIGHT", "https://tiles.example.com/light.json");
    expect(getMapLibreTileStyleLight()).toBe("https://tiles.example.com/light.json");
  });

  it("maps the UI theme to a style URL (dark only when dark)", () => {
    expect(mapLibreStyleForTheme("dark")).toBe(appConfig.map.maplibre.tileStyle.dark);
    expect(mapLibreStyleForTheme("light")).toBe(appConfig.map.maplibre.tileStyle.light);
    expect(mapLibreStyleForTheme(undefined)).toBe(appConfig.map.maplibre.tileStyle.light);
  });
});
