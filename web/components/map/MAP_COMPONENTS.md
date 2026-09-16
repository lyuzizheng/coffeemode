# Map Components (map-home, BRAWUKA-311)

The live basemap surface for `/` — a replaceable layer (owner directive
2026-09-16): the surface binds to `IMapProvider`, never to a renderer. The
provider component is selected by `map.provider` in app.yaml through the
`providers.ts` registry (BRAWUKA-329): a Google/Apple swap is a new provider
file + one registry entry + a `map.<provider>` config block — never a
`discovery-map.tsx` change. The archived provider-switching `MapContainer`
was deliberately NOT ported (its load-time geolocation violated DG112).

## Architecture

```
app/page.tsx
  └─ OnboardingHome (welcome card + LocateButton + MapAccountChip → mapOverlay slot)
       └─ DiscoveryHome ── provides DiscoveryMapContext {controller, cafes, center}
            ├─ DesktopDiscovery / MobileSheet   (data path — map-independent)
            └─ children = <MapSurface/>          (components/map/map-surface.tsx)
                 └─ next/dynamic ssr:false → DiscoveryMap (discovery-map.tsx)
                      └─ MAP_PROVIDERS[map.provider] → MapLibreProvider
                           └─ maplibre-gl Map
```

- **map-surface.tsx** — client-only entry. SSR renders the skeleton in the
  same slot; the maplibre chunk + map init defer to `requestIdleCallback`
  (LCP/TBT headroom); an error boundary + `onError` degrade the slot to a
  retryable error card. The sheet keeps working — the data path never
  touches the map.
- **providers.ts** — `MAP_PROVIDERS` registry: `map.provider` (app.yaml) →
  provider component. Adding a provider = new file + one entry here.
- **maplibre-provider.tsx** — the renderer implementation. Mount-once
  MapLibre wrapper: `initialCenter`/`initialZoom` are constructor-time only;
  later camera moves go through the `IMapProvider` adapter handed to
  `onLoad`. Owns every MapLibre concern — pin images, cafe source/layers,
  click/hover wiring, `style.load` rebind (re-applies data + selection after
  a theme switch), and theme→style-URL resolution via `maplibre-config.ts`.
  `attributionControl` ON (OpenMapTiles license). Non-tile errors before
  first paint → `onError`; per-tile errors stay non-fatal.
- **maplibre-config.ts** — the `map.maplibre` client readers (style URLs) +
  `mapLibreStyleForTheme`. Standalone so tests skip the maplibre-gl chunk.
- **discovery-map.tsx** — renderer-agnostic: binds discovery state to
  `IMapProvider` (theme → provider `theme` prop, cafes → `setCafes`,
  selection → `setSelectedCafe` + flyTo, taps → `onCafeSelect` → controller).
- **use-map-bindings.ts** — the one-way sync effects (padding, center sync,
  selection camera, cafe data + selection) — all through `IMapProvider`.
- **cafe-pins.ts** — MapLibre-internal pin artwork + layer registration;
  imported only by maplibre-provider.tsx.
- **Style documents** — both themes load full style JSONs from the tile host
  (`map.maplibre.tileStyle.light`/`dark` in app.yaml; OFM `liberty`/`dark`);
  the app never owns a local style document.
- **types.ts** — `IMapProvider` / `BaseMapProviderProps` — the swap
  boundary. No renderer types cross it (`Coordinates` from `lib/cities`,
  `CafeSummary` from `types/cafes`). Optional capability members
  (BRAWUKA-330, implemented by the MapLibre provider): `onMapTap` (empty-map
  tap / long-press → create entry), `getBounds` + `onIdle` (camera-settled
  `moveend`, the "search this area" trigger), `setExternalPins` (external
  POI pins on a source/layers separate from `setCafes` — never folded into
  `CafeSummary`). Consumers feature-detect (`provider.onMapTap?.(…)`).
- **map-account-chip.tsx** — the floating account + theme affordance
  (BRAWUKA-318): avatar initial → `/profile` when signed in, "Sign in" →
  `/profile` (which renders the sign-in gate) when not, plus a chromeless
  `ThemeToggle`. Rendered by OnboardingHome inside `mapOverlay`, so
  `gateMapOverlay` hides it above PEEK; on desktop it sits left of the
  locate button's top-right corner.

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

`web/config/app.yaml` → `map:` — `provider` (discriminator selecting a
`map.<provider>` block), `defaultZoom`, `focusZoom` (provider-agnostic
product parameters), `maplibre.tileStyle.light`/`dark` (full style document
URLs; the style documents carry their own glyphs/sprite). Provider id + zooms
are mirrored to the client via `NEXT_PUBLIC_MAP_*` in `next.config.ts` and
read through `lib/client-env.ts`; the MapLibre style URLs go through
`NEXT_PUBLIC_MAPLIBRE_*` and `maplibre-config.ts`.

## Failure modes

- Tile host down / WebGL unavailable / chunk load failure → error card with
  Retry; discovery UI unaffected.
- A failed theme-switch `setStyle` (style fetch error while `stylePending`)
  → same error card — the old style is already swapped out, so logging to a
  blank map is not an option.
- Individual tile/glyph failures → logged, non-fatal (holes in the basemap,
  not a dead map).
- e2e/visual suites stub `tiles.openfreemap.org` via
  `scripts/lib/tile-stubs.mjs` — no network needed.
