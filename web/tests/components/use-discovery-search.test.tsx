import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiscoverySearch } from "@/components/discovery/use-discovery-search";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { SearchResultItem } from "@/lib/search/types";
import type { POI } from "@shared/places/types";
import type { CafeSummary } from "@/types/cafes";

import { emptyWorkStats } from "@/lib/stats/work-stats";

describe("useDiscoverySearch (BRAWUKA-402)", () => {
  const mockController: DiscoveryController = {
    selectedCafeId: null,
    snap: "peek",
    select: vi.fn(),
    snapTo: vi.fn(),
    close: vi.fn(),
    handleMissingCafe: vi.fn(),
    registerCardRef: vi.fn(),
    detailHeadingRef: vi.fn(),
  };

  const sampleCafe: CafeSummary = {
    id: "cafe-uuid-1",
    name: "Cafe One",
    address: "Street 1",
    lat: 1.3,
    lng: 103.8,
    city: "Singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: null,
    work_stats: emptyWorkStats(),
    cover: null,
    distance_m: 50,
    maintained_by_service: false,
  };

  const sampleGooglePoi: POI = {
    place_id: "google-place-1",
    source: "google",
    name: "Google Coffee",
    lat: 1.31,
    lng: 103.81,
    address: "Google Street",
    types: ["cafe"],
    business_status: "OPERATIONAL",
    hours_json: null,
    fetched_at: "2026-09-18T00:00:00.000Z",
  };

  const sampleApplePoi: POI = {
    place_id: "apple-place-1",
    source: "apple",
    name: "Apple Coffee",
    lat: 1.32,
    lng: 103.82,
    address: "Apple Avenue",
    types: ["cafe"],
    business_status: null,
    hours_json: null,
    fetched_at: "2026-09-18T00:00:00.000Z",
  };

  it("sets persist to false when selecting a Google POI from unified search", () => {
    const { result } = renderHook(() =>
      useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
      }),
    );

    const googleItem: SearchResultItem = {
      id: sampleGooglePoi.place_id,
      type: "poi",
      source: "google",
      name: sampleGooglePoi.name,
      address: sampleGooglePoi.address,
      lat: sampleGooglePoi.lat,
      lng: sampleGooglePoi.lng,
      distance_m: 100,
      is_from_city_center: false,
      poi: sampleGooglePoi,
    };

    act(() => {
      result.current.search.onSelectResult(googleItem);
    });

    expect(result.current.creationOpen).toBe(true);
    expect(result.current.creationDraft).toEqual({
      poi: sampleGooglePoi,
      persist: false,
      provider: null,
    });
  });

  it("sets persist to true when selecting an Apple POI from unified search", () => {
    const { result } = renderHook(() =>
      useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
      }),
    );

    const appleItem: SearchResultItem = {
      id: sampleApplePoi.place_id,
      type: "poi",
      source: "apple",
      name: sampleApplePoi.name,
      address: sampleApplePoi.address,
      lat: sampleApplePoi.lat,
      lng: sampleApplePoi.lng,
      distance_m: 200,
      is_from_city_center: false,
      poi: sampleApplePoi,
    };

    act(() => {
      result.current.search.onSelectResult(appleItem);
    });

    expect(result.current.creationOpen).toBe(true);
    expect(result.current.creationDraft).toEqual({
      poi: sampleApplePoi,
      persist: true,
      provider: null,
    });
  });

  it("sets persist to false when selecting a stored_poi fixture from unified search", () => {
    const { result } = renderHook(() =>
      useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
      }),
    );

    const storedItem: SearchResultItem = {
      id: sampleGooglePoi.place_id,
      type: "poi",
      source: "stored_poi",
      name: sampleGooglePoi.name,
      address: sampleGooglePoi.address,
      lat: sampleGooglePoi.lat,
      lng: sampleGooglePoi.lng,
      distance_m: 150,
      is_from_city_center: false,
      poi: sampleGooglePoi,
    };

    act(() => {
      result.current.search.onSelectResult(storedItem);
    });

    expect(result.current.creationOpen).toBe(true);
    expect(result.current.creationDraft).toEqual({
      poi: sampleGooglePoi,
      persist: false,
      provider: null,
    });
  });

  it("selects cafe and updates map dataset when selecting a cafe result", () => {
    const controller = { ...mockController, select: vi.fn() };
    const { result } = renderHook(() =>
      useDiscoverySearch({
        controller,
        nearbyCafes: [],
        mapkitConfigured: true,
      }),
    );

    const cafeItem: SearchResultItem = {
      id: sampleCafe.id,
      type: "cafe",
      source: "coffeemode",
      name: sampleCafe.name,
      address: sampleCafe.address,
      lat: sampleCafe.lat,
      lng: sampleCafe.lng,
      distance_m: sampleCafe.distance_m ?? null,
      is_from_city_center: false,
      cafe: sampleCafe,
    };

    act(() => {
      result.current.search.onSelectResult(cafeItem);
    });

    expect(controller.select).toHaveBeenCalledWith(sampleCafe.id);
    expect(result.current.mapCafes).toContainEqual(sampleCafe);
    expect(result.current.creationOpen).toBe(false);
  });

  it("opens creation sheet on specific provider when external search CTA clicked", () => {
    const { result } = renderHook(() =>
      useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
      }),
    );

    act(() => {
      result.current.search.onExternalSearch("google");
    });

    expect(result.current.creationOpen).toBe(true);
    expect(result.current.creationDraft).toEqual({
      poi: null,
      persist: false,
      provider: "google",
    });
  });
});
