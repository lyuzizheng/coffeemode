import { describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DetailContent } from "@/components/discovery/detail-content";
import { CafeDetailSeed } from "@/app/cafes/[id]/cafe-detail-seed";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { PublicCafeDetail } from "@/types/cafes";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";

// IndexedDB is not available in jsdom — the DG66 draft store is mocked.
vi.mock("@/lib/checkin/pending-checkin", () => ({
  savePendingCheckin: vi.fn().mockResolvedValue(undefined),
  loadPendingCheckin: vi.fn().mockResolvedValue(null),
  clearPendingCheckin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));

const CAFE_ID = "550e8400-e29b-41d4-a716-446655440000";
const DETAIL_URL = `/api/cafes/${CAFE_ID}`;
const FEED_URL = `/api/cafes/${CAFE_ID}/checkins?mode=newest`;

/**
 * The FULL variant embeds the check-in feed, which fetches independently —
 * the seed only promises no re-fetch of the cafe detail URL itself.
 */
function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).startsWith(FEED_URL)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ checkins: [], next_cursor: null }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
  });
}

type FetchSpy = Mock<(url: string) => Promise<unknown>>;
function expectNoDetailFetch(fetchSpy: FetchSpy) {
  expect(fetchSpy.mock.calls.filter(([url]) => String(url) === DETAIL_URL)).toHaveLength(0);
}

const SEEDED_CAFE: PublicCafeDetail = {
  id: CAFE_ID,
  name: "Seeded Roastery",
  lat: 1.29027,
  lng: 103.851959,
  address: "22 Martin Rd",
  city: "singapore",
  tz: "Asia/Singapore",
  opening_hours: null,
  price_range: 2,
  work_stats: emptyWorkStats(),
  cover: null,
  description: null,
  gallery: [],
  google_place_id: null,
  apple_poi_id: null,
  source: "user_confirmed",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  author: null,
  maintained_by_service: false,
  owned_by_viewer: false,
};

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

function renderWithClient(queryClient: QueryClient, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("cafe detail SSR seeding (BRAWUKA-283 P2-3)", () => {
  it("serves a setQueryData-seeded [cafe, id] entry with no detail fetch", async () => {
    const fetchSpy = stubFetch();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(["cafe", CAFE_ID], SEEDED_CAFE, { updatedAt: Date.now() });
      renderWithClient(
        queryClient,
        <DetailContent cafeId={CAFE_ID} variant="full" controller={stubController()} onCheckIn={vi.fn()} />,
      );
      expect(await screen.findByRole("heading", { name: "Seeded Roastery" })).toBeInTheDocument();
      expectNoDetailFetch(fetchSpy);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("CafeDetailSeed fills the [cafe, id] cache so a later DetailContent mounts without fetching", async () => {
    const fetchSpy = stubFetch();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { unmount } = renderWithClient(queryClient, <CafeDetailSeed cafe={SEEDED_CAFE} />);
      unmount();
      renderWithClient(
        queryClient,
        <DetailContent cafeId={CAFE_ID} variant="full" controller={stubController()} onCheckIn={vi.fn()} />,
      );
      expect(await screen.findByRole("heading", { name: "Seeded Roastery" })).toBeInTheDocument();
      expectNoDetailFetch(fetchSpy);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
