import { boundedNumber, fail, nonEmptyString, record } from "./primitives";
import type { AppConfig } from "./types";

type MapConfig = AppConfig["map"];

/** Style document locator (BRAWUKA-362): either an absolute https: URL (a
 * remote tile host) or a root-relative path (`/map/…`) served same-origin
 * from `web/public/` — MapLibre resolves it against the page origin, so the
 * same value works in dev, staging, and production without a hardcoded
 * host. Protocol-relative `//host/…` is rejected: it would silently leave
 * the origin. */
function styleUrl(file: string, keyPath: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(file, keyPath, "must be a non-empty string");
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(file, keyPath, "must be an https: URL or a root-relative path");
  }
  if (parsed.protocol !== "https:") {
    fail(file, keyPath, "must be an https: URL or a root-relative path");
  }
  return value;
}

/** Known `map.provider` values — each needs a `map.<provider>` block and a
 * matching entry in `components/map/providers.ts`. */
const KNOWN_PROVIDERS: Record<string, true> = { maplibre: true };

/** Validate the `map` subtree of app.yaml (basemap provider seam;
 * BRAWUKA-329: `provider` discriminator + per-provider blocks; zooms stay
 * top-level product parameters consumed by the provider-agnostic camera
 * bindings). */
export function parseMapSection(file: string, map: Record<string, unknown>): MapConfig {
  const provider = nonEmptyString(file, "map.provider", map.provider);
  if (!KNOWN_PROVIDERS[provider]) {
    fail(file, "map.provider", `must be one of: ${Object.keys(KNOWN_PROVIDERS).join(", ")}`);
  }
  const maplibre = record(file, "map.maplibre", map.maplibre);
  const tileStyle = record(file, "map.maplibre.tileStyle", maplibre.tileStyle);
  return {
    provider,
    defaultZoom: boundedNumber(file, "map.defaultZoom", map.defaultZoom, 1, 22),
    focusZoom: boundedNumber(file, "map.focusZoom", map.focusZoom, 1, 22),
    maplibre: {
      tileStyle: {
        light: styleUrl(file, "map.maplibre.tileStyle.light", tileStyle.light),
        dark: styleUrl(file, "map.maplibre.tileStyle.dark", tileStyle.dark),
      },
    },
  };
}
