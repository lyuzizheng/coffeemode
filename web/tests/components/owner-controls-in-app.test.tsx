import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DetailContent } from "@/components/discovery/detail-content";
import { CafeCardBody } from "@/components/discovery/cafe-card";
import { ProfileTabCafes } from "@/components/profile/profile-tab-cafes";
import { SearchResultsList } from "@/components/search/search-results-list";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary, PublicCafeDetail } from "@/types/cafes";
import type { UserCafeItemDto } from "@/lib/db/profile";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

// DG146/DG147 in-app surfaces (BRAWUKA-515): the owner controls and the
// 仅你可见 badge must render inside the app, not only on the SSR page.

const CAFE_ID = "550e8400-e29b-41d4-a716-446655440000";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// IndexedDB is not available in jsdom — the DG66 draft store is mocked.
vi.mock("@/lib/checkin/pending-checkin", () => ({
  savePendingCheckin: vi.fn().mockResolvedValue(undefined),
  loadPendingCheckin: vi.fn().mockResolvedValue(null),
  clearPendingCheckin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));

function Wrapper({ children, locale = "en" }: { children: ReactNode; locale?: "en" | "zh" }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

function makeSummary(overrides: Partial<CafeSummary> = {}): CafeSummary {
  return {
    id: CAFE_ID,
    name: "Hidden Roastery",
    lat: 1.29,
    lng: 103.85,
    address: "22 Martin Rd",
    city: "singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: 2,
    work_stats: emptyWorkStats(),
    cover: null,
    maintained_by_service: false,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<PublicCafeDetail> = {}): PublicCafeDetail {
  return {
    ...makeSummary(),
    description: null,
    gallery: [],
    google_place_id: null,
    apple_poi_id: null,
    source: "user_confirmed",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    author: null,
    owned_by_viewer: false,
    ...overrides,
  };
}

function stubController(): DiscoveryController {
  return {
    selectedCafeId: CAFE_ID,
    snap: "full",
    select: vi.fn(),
    snapTo: vi.fn(),
    close: vi.fn(),
    handleMissingCafe: vi.fn(),
    registerCardRef: vi.fn(),
    detailHeadingRef: vi.fn(),
  };
}

function stubDetailFetch(cafe: PublicCafeDetail) {
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u === `/api/cafes/${CAFE_ID}`) {
      return Promise.resolve(jsonResponse(200, cafe));
    }
    if (u.startsWith(`/api/cafes/${CAFE_ID}/checkins`)) {
      return Promise.resolve(jsonResponse(200, { checkins: [], next_cursor: null }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

function renderDetail(cafe: PublicCafeDetail) {
  const fetchSpy = stubDetailFetch(cafe);
  vi.stubGlobal("fetch", fetchSpy);
  return render(
    <DetailContent cafeId={CAFE_ID} variant="full" controller={stubController()} onCheckIn={vi.fn()} />,
    { wrapper: Wrapper },
  );
}

describe("DetailContent owner controls (DG146/DG147)", () => {
  it("renders the visibility switch and delete entry for the owner", async () => {
    try {
      renderDetail(
        makeDetail({
          owned_by_viewer: true,
          visibility: "public",
          work_stats: { ...emptyWorkStats(), n_checkins: 1 },
        }),
      );
      expect(
        await screen.findByRole("region", { name: "Manage this cafe" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Only visible to you")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides controls for a non-owner detail", async () => {
    try {
      renderDetail(makeDetail({ owned_by_viewer: false }));
      expect(await screen.findByRole("heading", { name: "Hidden Roastery" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Manage this cafe" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides the delete entry on an empty shell but keeps the switch", async () => {
    try {
      renderDetail(makeDetail({ owned_by_viewer: true, work_stats: emptyWorkStats() }));
      expect(
        await screen.findByRole("region", { name: "Manage this cafe" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the private badge in the detail heading for an owner-private cafe", async () => {
    try {
      renderDetail(makeDetail({ owned_by_viewer: true, visibility: "private" }));
      expect(await screen.findByText("Only you can see this")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Private badge on cafe rows (DG147)", () => {
  it("marks a private cafe in the discovery card body", () => {
    render(<CafeCardBody cafe={makeSummary({ visibility: "private" })} />, { wrapper: Wrapper });
    expect(screen.getByText("Only you can see this")).toBeInTheDocument();
  });

  it("does not mark public cafes", () => {
    render(<CafeCardBody cafe={makeSummary({ visibility: "public" })} />, { wrapper: Wrapper });
    expect(screen.queryByText("Only you can see this")).not.toBeInTheDocument();
  });

  it("renders the zh badge copy", () => {
    render(<CafeCardBody cafe={makeSummary({ visibility: "private" })} />, {
      wrapper: ({ children }) => <Wrapper locale="zh">{children}</Wrapper>,
    });
    expect(screen.getByText("仅你可见")).toBeInTheDocument();
  });
});

describe("Private badge in profile 我的咖啡地图 (DG147)", () => {
  function stubQuery(items: UserCafeItemDto[]) {
    return {
      data: { pages: [{ items, next_cursor: null }], pageParams: [undefined] },
      isError: false,
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as Parameters<typeof ProfileTabCafes>[0]["query"];
  }

  const baseItem: UserCafeItemDto = {
    id: CAFE_ID,
    name: "Hidden Roastery",
    city: "singapore",
    cover: null,
    last_visited_at: "2026-09-01T00:00:00.000Z",
    checkins_count: 2,
    is_creation: true,
    visibility: "private",
  };

  it("composes the private badge with the created-by-me marker", () => {
    render(<ProfileTabCafes baseId="profile" query={stubQuery([baseItem])} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Only you can see this")).toBeInTheDocument();
    expect(screen.getByText("created by me", { exact: false })).toBeInTheDocument();
  });

  it("does not mark public cafes", () => {
    render(
      <ProfileTabCafes baseId="profile" query={stubQuery([{ ...baseItem, visibility: "public" }])} />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText("Only you can see this")).not.toBeInTheDocument();
  });
});

describe("Private badge in search results (DG147)", () => {
  function renderResults(item: SearchResultItem) {
    const response: SearchResponse = {
      results: [item],
      total_count: 1,
      is_weak_results: false,
      reference_point: { lat: 1.3, lng: 103.8, is_from_city_center: false },
    };
    render(
      <SearchResultsList
        response={response}
        externalSources={{ google: false, apple: false }}
        mapkitConfigured={false}
        onSelect={vi.fn()}
        onExternalSearch={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
  }

  it("marks a private cafe result", () => {
    renderResults({
      id: CAFE_ID,
      type: "cafe",
      source: "coffeemode",
      name: "Hidden Roastery",
      address: "22 Martin Rd",
      lat: 1.29,
      lng: 103.85,
      distance_m: null,
      is_from_city_center: false,
      cafe: makeSummary({ visibility: "private" }),
    });
    expect(screen.getByText("Only you can see this")).toBeInTheDocument();
  });

  it("does not mark public or POI results", () => {
    renderResults({
      id: CAFE_ID,
      type: "cafe",
      source: "coffeemode",
      name: "Public Roastery",
      address: "22 Martin Rd",
      lat: 1.29,
      lng: 103.85,
      distance_m: null,
      is_from_city_center: false,
      cafe: makeSummary({ visibility: "public" }),
    });
    expect(screen.queryByText("Only you can see this")).not.toBeInTheDocument();
  });
});
