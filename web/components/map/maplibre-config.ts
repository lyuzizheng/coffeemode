/**
 * MapLibre provider config readers (BRAWUKA-329): the `map.maplibre` block of
 * app.yaml, mirrored to the client via `NEXT_PUBLIC_MAPLIBRE_*` in
 * next.config.ts. Kept in a standalone module so tests can exercise the
 * getters without importing the maplibre-gl chunk.
 */
import { envNonEmptyString } from "@/lib/client-env";

/** `map.maplibre.tileStyle.light` — full style document URL for the light basemap. */
export function getMapLibreTileStyleLight(): string {
  return envNonEmptyString(
    process.env.NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_LIGHT,
    "https://tiles.openfreemap.org/styles/liberty",
  );
}

/** `map.maplibre.tileStyle.dark` — full style document URL for the dark basemap. */
export function getMapLibreTileStyleDark(): string {
  return envNonEmptyString(
    process.env.NEXT_PUBLIC_MAPLIBRE_TILE_STYLE_DARK,
    "https://tiles.openfreemap.org/styles/dark",
  );
}

/** UI theme → style document URL. The theme→style mapping is a MapLibre
 * concern (BRAWUKA-329): the surface passes `theme` and never sees a URL. */
export function mapLibreStyleForTheme(theme: string | undefined): string {
  return theme === "dark" ? getMapLibreTileStyleDark() : getMapLibreTileStyleLight();
}
