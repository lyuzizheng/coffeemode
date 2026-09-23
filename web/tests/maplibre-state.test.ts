import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { GeoJSONSource } from "maplibre-gl";
import type { CafeSummary } from "@/types/cafes";

const loadPinImagesMock = vi.fn<(map?: unknown) => Promise<void>>();
const bindCafeLayersMock = vi.fn<(map?: unknown) => void>();
const bindExternalPinLayersMock = vi.fn<(map?: unknown) => void>();
const bindUserLocationLayersMock = vi.fn<(map?: unknown) => void>();
const cafesToGeoJSONMock = vi.fn<(cafes?: unknown) => { type: string; features: unknown[] }>(() => ({
  type: "FeatureCollection",
  features: [],
}));
const externalPinsToGeoJSONMock = vi.fn<(pins?: unknown) => { type: string; features: unknown[] }>(() => ({
  type: "FeatureCollection",
  features: [],
}));
const userLocationToGeoJSONMock = vi.fn<(loc?: unknown) => { type: string; features: unknown[] }>(() => ({
  type: "FeatureCollection",
  features: [],
}));

vi.mock("@/components/map/cafe-pins", () => ({
  loadPinImages: (map: unknown) => loadPinImagesMock(map),
  bindCafeLayers: (map: unknown) => bindCafeLayersMock(map),
  bindExternalPinLayers: (map: unknown) => bindExternalPinLayersMock(map),
  bindUserLocationLayers: (map: unknown) => bindUserLocationLayersMock(map),
  cafesToGeoJSON: (cafes: unknown) => cafesToGeoJSONMock(cafes),
  externalPinsToGeoJSON: (pins: unknown) => externalPinsToGeoJSONMock(pins),
  userLocationToGeoJSON: (loc: unknown) => userLocationToGeoJSONMock(loc),
  CAFE_SOURCE: "cafes",
  CLUSTER_LAYER: "clusters",
  EXTERNAL_PIN_LAYER: "external-pins-layer",
  EXTERNAL_SOURCE: "external-pins",
  PIN_LAYER: "pins",
  USER_LOCATION_SOURCE: "user-location",
}));

import {
  isMapDestroyed,
  rebindMapLayers,
  type ProviderState,
} from "@/components/map/maplibre-state";

function createMockMap(overrides: Partial<Record<string, unknown>> = {}): MapLibreMap {
  const sources = new Map<string, unknown>();
  const mock = {
    _removed: false,
    style: {},
    getSource: vi.fn((id: string) => sources.get(id)),
    setFeatureState: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    getLayer: vi.fn(() => ({})),
    getCanvas: vi.fn(() => ({ style: {} })),
    ...overrides,
  };
  return mock as unknown as MapLibreMap;
}

function createProviderState(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    cafes: [],
    externalPins: [],
    userLocation: null,
    selectedCafeId: null,
    onCafeSelect: null,
    onCameraGesture: null,
    stylePending: false,
    ...overrides,
  };
}

describe("maplibre-state lifecycle and teardown resilience (BRAWUKA-581)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPinImagesMock.mockResolvedValue(undefined);
  });

  describe("isMapDestroyed", () => {
    it("returns false for a live map with active style", () => {
      const map = createMockMap({ _removed: false, style: {} });
      expect(isMapDestroyed(map)).toBe(false);
    });

    it("returns true when _removed is true", () => {
      const map = createMockMap({ _removed: true, style: {} });
      expect(isMapDestroyed(map)).toBe(true);
    });

    it("returns true when style is null or missing (e.g. setStyle(null) during map.remove())", () => {
      const map = createMockMap({ _removed: false, style: null });
      expect(isMapDestroyed(map)).toBe(true);
    });
  });

  describe("rebindMapLayers", () => {
    it("skips pin loading and layer binding when map is already destroyed", async () => {
      const map = createMockMap({ _removed: true });
      const state = createProviderState({ stylePending: true });

      rebindMapLayers(map, state);

      expect(state.stylePending).toBe(false);
      expect(loadPinImagesMock).not.toHaveBeenCalled();
      expect(bindCafeLayersMock).not.toHaveBeenCalled();
    });

    it("catches and ignores rejection if map is removed while loadPinImages is in flight", async () => {
      let rejectPromise!: (err: Error) => void;
      loadPinImagesMock.mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectPromise = reject;
          }),
      );

      const map = createMockMap({ _removed: false, style: {} });
      const state = createProviderState();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      rebindMapLayers(map, state);

      // Simulate map destruction (e.g. component unmount calling map.remove())
      (map as unknown as { _removed: boolean; style: unknown })._removed = true;
      (map as unknown as { _removed: boolean; style: unknown }).style = null;

      // Now reject the pending pin loading
      rejectPromise(new TypeError("Cannot read properties of null (reading 'getImage')"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(bindCafeLayersMock).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("skips layer binding if map becomes destroyed before .then runs", async () => {
      let resolvePromise!: () => void;
      loadPinImagesMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePromise = resolve;
          }),
      );

      const map = createMockMap({ _removed: false, style: {} });
      const state = createProviderState();

      rebindMapLayers(map, state);

      // Destroy map before resolution
      (map as unknown as { _removed: boolean })._removed = true;

      resolvePromise();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bindCafeLayersMock).not.toHaveBeenCalled();
    });

    it("logs error and handles rejection without unhandled exception when map is alive", async () => {
      const liveError = new Error("Network error fetching pin image");
      loadPinImagesMock.mockRejectedValue(liveError);

      const map = createMockMap({ _removed: false, style: {} });
      const state = createProviderState();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      rebindMapLayers(map, state);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[map] failed to rebind map layers:",
        liveError,
      );
      expect(bindCafeLayersMock).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("successfully binds layers and pushes data when map is healthy", async () => {
      const mockCafeSource = Object.create(GeoJSONSource.prototype);
      mockCafeSource.setData = vi.fn();

      const mockExternalSource = Object.create(GeoJSONSource.prototype);
      mockExternalSource.setData = vi.fn();

      const mockUserSource = Object.create(GeoJSONSource.prototype);
      mockUserSource.setData = vi.fn();

      const map = createMockMap({
        getSource: vi.fn((id: string) => {
          if (id === "cafes") return mockCafeSource;
          if (id === "external-pins") return mockExternalSource;
          if (id === "user-location") return mockUserSource;
          return null;
        }),
      });

      const state = createProviderState({
        cafes: [{ id: "cafe-1", name: "Cafe One", lat: 10, lng: 20 } as unknown as CafeSummary],
        selectedCafeId: "cafe-1",
      });

      rebindMapLayers(map, state);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bindCafeLayersMock).toHaveBeenCalledWith(map);
      expect(bindExternalPinLayersMock).toHaveBeenCalledWith(map);
      expect(bindUserLocationLayersMock).toHaveBeenCalledWith(map);
      expect(mockCafeSource.setData).toHaveBeenCalled();
      expect(mockExternalSource.setData).toHaveBeenCalled();
      expect(mockUserSource.setData).toHaveBeenCalled();
      expect(map.setFeatureState).toHaveBeenCalledWith(
        { source: "cafes", id: "cafe-1" },
        { selected: true },
      );
    });
  });
});
