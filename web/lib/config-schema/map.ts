import { boundedNumber, fail, record } from "./primitives";
import type { AppConfig } from "./types";

type MapConfig = AppConfig["map"];

function httpsUrl(file: string, keyPath: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(file, keyPath, "must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(file, keyPath, "must be an absolute URL");
  }
  if (parsed.protocol !== "https:") {
    fail(file, keyPath, "must be an https: URL");
  }
  return value;
}

function templateUrl(file: string, keyPath: string, value: unknown): string {
  const url = httpsUrl(file, keyPath, value);
  if (url.includes(" ")) {
    fail(file, keyPath, "must not contain spaces");
  }
  return url;
}

/** Validate the `map` subtree of app.yaml (basemap provider seam;
 * zoom levels added by map-home, BRAWUKA-311). */
export function parseMapSection(file: string, map: Record<string, unknown>): MapConfig {
  const tileStyle = record(file, "map.tileStyle", map.tileStyle);
  return {
    tileStyle: {
      light: httpsUrl(file, "map.tileStyle.light", tileStyle.light),
      dark: httpsUrl(file, "map.tileStyle.dark", tileStyle.dark),
    },
    glyphs: templateUrl(file, "map.glyphs", map.glyphs),
    sprite: httpsUrl(file, "map.sprite", map.sprite),
    defaultZoom: boundedNumber(file, "map.defaultZoom", map.defaultZoom, 1, 22),
    focusZoom: boundedNumber(file, "map.focusZoom", map.focusZoom, 1, 22),
  };
}
