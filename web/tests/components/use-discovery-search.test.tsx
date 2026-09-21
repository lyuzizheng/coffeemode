import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoverySearch } from "@/components/discovery/use-discovery-search";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import * as onboardingStore from "@/lib/onboarding-store";
import type { SearchResultItem } from "@/lib/search/types";
import type { POI } from "@shared/places/types";
import type { CafeSummary } from "@/types/cafes";

import { emptyWorkStats } from "@/lib/stats/work-stats";

// The onboarding store is the DG51 persistence seam — jsdom has no
// localStorage, so the write is asserted at the module boundary.
vi.mock("@/lib/onboarding-store", async (importOriginal) => {
  const actual = await importOriginal<typeof onboardingStore>();
  return { ...actual, writeOnboardingState: vi.fn() };
});

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

describe("useDiscoverySearch filter/city state (BRAWUKA-512)", () => {
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

  const renderSearch = (props?: { isAuthenticated?: boolean }) =>
    renderHook(() =>
      useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
        city: "singapore",
        isAuthenticated: props?.isAuthenticated,
      }),
    );

  beforeEach(() => {
    vi.mocked(onboardingStore.writeOnboardingState).mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("restores q/city/filters from the deep-link URL (DG48)", () => {
    window.history.replaceState(
      null,
      "",
      "/?q=latte&city=tokyo&open_now=true&filter_wifi=60&filter_max_stay=2h",
    );
    const { result } = renderSearch();
    expect(result.current.search.query).toBe("latte");
    expect(result.current.search.city).toBe("tokyo");
    expect(result.current.search.filters).toEqual({
      openNow: true,
      thresholds: { wifi: 60 },
      maxStay: "2h",
    });
    expect(result.current.search.searchActive).toBe(true);
  });

  it("writes filter state to the URL via replace, never push (DG48)", () => {
    const { result } = renderSearch();
    act(() => {
      result.current.search.onFiltersChange({
        openNow: false,
        thresholds: { wifi: 80 },
        maxStay: null,
      });
    });
    expect(window.location.search).toBe("?filter_wifi=80");
    // Session-scoped (DG51): filters never touch the onboarding store.
    expect(onboardingStore.writeOnboardingState).not.toHaveBeenCalled();
  });

  it("city change clears the query, refetches scope, and persists (DG50/DG51)", () => {
    const { result } = renderSearch();
    act(() => {
      result.current.search.onQueryChange("latte");
    });
    act(() => {
      result.current.search.onCityChange("tokyo");
    });
    // Anonymous persistence lands in the onboarding store (DG51).
    expect(onboardingStore.writeOnboardingState).toHaveBeenCalledWith({
      currentCity: "tokyo",
      currentCityName: null,
    });
    expect(window.location.search).toBe("?city=tokyo");
  });

  it("searchActive is true with filters on and an empty query (browse mode)", () => {
    const { result } = renderSearch();
    expect(result.current.search.searchActive).toBe(false);
    act(() => {
      result.current.search.onFiltersChange({
        openNow: true,
        thresholds: {},
        maxStay: null,
      });
    });
    expect(result.current.search.searchActive).toBe(true);
  });

  it("first render matches the SSR frame before restoring the deep link (BRAWUKA-575)", () => {
    window.history.replaceState(
      null,
      "",
      "/?q=latte&city=tokyo&filter_wifi=60",
    );
    // Capture render-phase values — frame[0] is what hydration compares
    // against the server-rendered HTML, so it must carry the empty
    // snapshot, not the `?q=` deep link.
    const frames: Array<{ query: string; city?: string; active: boolean }> = [];
    function Probe() {
      const { search } = useDiscoverySearch({
        controller: mockController,
        nearbyCafes: [],
        mapkitConfigured: true,
        city: "singapore",
      });
      frames.push({
        query: search.query,
        city: search.city,
        active: search.searchActive,
      });
      return null;
    }
    render(<Probe />);
    expect(frames[0]).toEqual({ query: "", city: "singapore", active: false });
    expect(frames[frames.length - 1]).toEqual({
      query: "latte",
      city: "tokyo",
      active: true,
    });
    // The URL writer must not wipe the deep link before the restore reads it.
    expect(window.location.search).toContain("q=latte");
    expect(window.location.search).toContain("city=tokyo");
    expect(window.location.search).toContain("filter_wifi=60");
  });
});

