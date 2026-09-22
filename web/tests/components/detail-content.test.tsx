import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DetailContent } from "@/components/discovery/detail-content";
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
const FEED_URL = `/api/cafes/${CAFE_ID}/checkins?mode=newest`;

const CAFE: PublicCafeDetail = {
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).startsWith(FEED_URL)) {
      return Promise.resolve(jsonResponse(200, { checkins: [], next_cursor: null }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
  });
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

function renderDetail(cafe: PublicCafeDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["cafe", CAFE_ID], cafe, { updatedAt: Date.now() });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <DetailContent
          cafeId={CAFE_ID}
          variant="full"
          controller={stubController()}
          onCheckIn={vi.fn()}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("DetailContent DG124 dossier additions", () => {
  it("shows the private badge on a private cafe (DG147 — owner-only payload)", async () => {
    vi.stubGlobal("fetch", stubFetch());
    try {
      renderDetail({ ...CAFE, visibility: "private" });
      expect(await screen.findByText("Only you can see this")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits the private badge on a public cafe", async () => {
    vi.stubGlobal("fetch", stubFetch());
    try {
      renderDetail(CAFE);
      expect(await screen.findByRole("heading", { name: "Seeded Roastery" })).toBeInTheDocument();
      expect(screen.queryByText("Only you can see this")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("DetailContent feed parallelization (BRAWUKA-646)", () => {
  it("issues the feed request in parallel and never refetches it on pending→loaded", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    let resolveDetail!: (r: Response) => void;
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith(FEED_URL)) {
        return Promise.resolve(jsonResponse(200, { checkins: [], next_cursor: null }));
      }
      if (u === `/api/cafes/${CAFE_ID}`) {
        return new Promise<Response>((resolve) => {
          resolveDetail = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>
            <DetailContent
              cafeId={CAFE_ID}
              variant="full"
              controller={stubController()}
              onCheckIn={vi.fn()}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      );
      // The feed request must be issued before the detail request resolves —
      // a waterfall would leave it unfired until `resolveDetail` runs.
      await waitFor(() => {
        expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith(FEED_URL))).toBe(true);
      });
      resolveDetail(jsonResponse(200, CAFE));
      expect(await screen.findByRole("heading", { name: "Seeded Roastery" })).toBeInTheDocument();
      // The feed keeps child index 1 inside FullShell across pending→loaded,
      // so it never remounts: exactly one page-1 fetch, no refetch.
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      const feedCalls = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith(FEED_URL));
      expect(feedCalls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
