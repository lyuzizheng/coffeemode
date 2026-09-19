/**
 * MapLibre provider config readers (BRAWUKA-329): the `map.maplibre` block of
 * app.yaml, mirrored to the client via `NEXT_PUBLIC_MAPLIBRE_*` in
 * next.config.ts. Kept in a standalone module so tests can exercise the
 * getters without importing the maplibre-gl chunk.
 */
import { envNonEmptyString } from "@/lib/client-env";

/** `map.maplibre.tileStyle.light` — style document URL/path for the light
 * basemap. Root-relative paths are served same-origin from `web/public/`. */
export function getMapLibreTileStyleLight(): string {
  return envNonEmptyString(
    process.env.NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_LIGHT,
    "/map/coffeemode_light.json",
  );
}

/** `map.maplibre.tileStyle.dark` — style document URL/path for the dark basemap. */
export function getMapLibreTileStyleDark(): string {
  return envNonEmptyString(
    process.env.NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_DARK,
    "/map/coffeemode_dark.json",
  );
}

/** UI theme → style document URL. The theme→style mapping is a MapLibre
 * concern (BRAWUKA-329): the surface passes `theme` and never sees a URL. */
export function mapLibreStyleForTheme(theme: string | undefined): string {
  return theme === "dark" ? getMapLibreTileStyleDark() : getMapLibreTileStyleLight();
}
