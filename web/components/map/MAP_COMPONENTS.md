# Map Components (map-home, BRAWUKA-311)

The live basemap surface for `/` — a replaceable layer (owner directive
2026-09-16): the surface binds to `IMapProvider`, never to a renderer. The
MapLibre GL implementation is `maplibre-provider.tsx`; a Google/Apple swap
is a new provider file + one import change in `discovery-map.tsx`, not a
rewrite. The archived provider-switching `MapContainer` was deliberately
NOT ported (its load-time geolocation violated DG112).

## Architecture

```
app/page.tsx
  └─ OnboardingHome (welcome card + LocateButton → mapOverlay slot)
       └─ DiscoveryHome ── provides DiscoveryMapContext {controller, cafes, center}
            ├─ DesktopDiscovery / MobileSheet   (data path — map-independent)
            └─ children = <MapSurface/>          (components/map/map-surface.tsx)
                 └─ next/dynamic ssr:false → DiscoveryMap (discovery-map.tsx)
                      └─ MapLibreProvider        (maplibre-provider.tsx)
                           └─ maplibre-gl Map
```

- **map-surface.tsx** — client-only entry. SSR renders the skeleton in the
  same slot; the maplibre chunk + map init defer to `requestIdleCallback`
  (LCP/TBT headroom); an error boundary + `onError` degrade the slot to a
  retryable error card. The sheet keeps working — the data path never
  touches the map.
- **maplibre-provider.tsx** — the renderer implementation. Mount-once
  MapLibre wrapper: `initialCenter`/`initialZoom` are constructor-time only;
  later camera moves go through the `IMapProvider` adapter handed to
  `onLoad`. Owns every MapLibre concern — pin images, cafe source/layers,
  click/hover wiring, `style.load` rebind (re-applies data + selection after
  a theme switch), `attributionControl` ON (OpenMapTiles license). Non-tile
  errors before first paint → `onError`; per-tile errors stay non-fatal.
- **discovery-map.tsx** — renderer-agnostic: binds discovery state to
  `IMapProvider` (theme → style URL, cafes → `setCafes`, selection →
  `setSelectedCafe` + flyTo, taps → `onCafeSelect` → controller).
- **use-map-bindings.ts** — the one-way sync effects (padding, center sync,
  selection camera, cafe data + selection) — all through `IMapProvider`.
- **cafe-pins.ts** — MapLibre-internal pin artwork + layer registration;
  imported only by maplibre-provider.tsx.
- **Style documents** — both themes load full style JSONs from the tile host
  (`map.tileStyle.light`/`dark` in app.yaml; OFM `liberty`/`dark`); the app
  never owns a local style document.
- **types.ts** — `IMapProvider` / `BaseMapProviderProps` — the swap
  boundary. No renderer types cross it (`Coordinates` from `lib/cities`,
  `CafeSummary` from `types/cafes`). Optional capability members
  (BRAWUKA-330, implemented by the MapLibre provider): `onMapTap` (empty-map
  tap / long-press → create entry), `getBounds` + `onIdle` (camera-settled
  `moveend`, the "search this area" trigger), `setExternalPins` (external
  POI pins on a source/layers separate from `setCafes` — never folded into
  `CafeSummary`). Consumers feature-detect (`provider.onMapTap?.(…)`).

## Camera contract

| Trigger | Effect |
| --- | --- |
| Resolved center changes (locate, city pick) | `flyTo` at `map.defaultZoom` (never zooms out) |
| Cafe selected (card or pin) | `flyTo` at `map.focusZoom` (never zooms out) |
| Deselect / user pan | nothing — the camera stays where the user left it |
| Cluster tap | `easeTo` cluster expansion zoom |

Padding follows chrome: mobile keeps pins above the sheet's visible detent
(PEEK 172px / HALF 50dvh / FULL 85dvh); desktop shifts right only while the
400px detail column overlays the map (<xl).

## Config

`web/config/app.yaml` → `map:` — `tileStyle.light`/`tileStyle.dark` (full
style document URLs), `glyphs`, `sprite` (informational — the style documents
carry their own), `defaultZoom`, `focusZoom`. Style URLs + zooms are mirrored
to the client via `NEXT_PUBLIC_MAP_*` in `next.config.ts` and read through
`lib/client-env.ts` getters.

## Failure modes

- Tile host down / WebGL unavailable / chunk load failure → error card with
  Retry; discovery UI unaffected.
- Individual tile/glyph failures → logged, non-fatal (holes in the basemap,
  not a dead map).
- e2e/visual suites stub `tiles.openfreemap.org` via
  `scripts/lib/tile-stubs.mjs` — no network needed.
