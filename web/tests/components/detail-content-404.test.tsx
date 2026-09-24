import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DetailContent } from "@/components/discovery/detail-content";
import { shouldRetryQuery } from "@/lib/query/retry";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import messages from "../../messages/en.json";

vi.mock("@/lib/checkin/pending-checkin", () => ({
  savePendingCheckin: vi.fn().mockResolvedValue(undefined),
  loadPendingCheckin: vi.fn().mockResolvedValue(null),
  clearPendingCheckin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ state: "online", isOnline: true }),
}));
vi.mock("@/components/discovery/checkin-feed", () => ({
  CheckinFeed: () => null,
}));

const CAFE_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => shouldRetryQuery(failureCount, error, true),
        retryDelay: () => 0,
      },
    },
  });
}

function stubController(handleMissingCafe: () => void): DiscoveryController {
  return {
    selectedCafeId: CAFE_ID,
    snap: "full",
    select: vi.fn(),
    snapTo: vi.fn(),
    close: vi.fn(),
    handleMissingCafe,
    registerCardRef: vi.fn(),
    detailHeadingRef: vi.fn(),
  };
}

describe("DetailContent 404 recovery (BRAWUKA-486)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not retry on 404 and invokes handleMissingCafe after exactly one request", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (String(url) === `/api/cafes/${CAFE_ID}`) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "cafe_not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const handleMissingCafe = vi.fn();
    const queryClient = makeClient();

    try {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>
            <DetailContent
              cafeId={CAFE_ID}
              variant="full"
              controller={stubController(handleMissingCafe)}
              onCheckIn={vi.fn()}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      );

      await waitFor(() => expect(handleMissingCafe).toHaveBeenCalledTimes(1));
      const cafeCalls = fetchSpy.mock.calls.filter(([url]) => String(url) === `/api/cafes/${CAFE_ID}`);
      expect(cafeCalls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries up to 2 times on 500 error following shared retry policy", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (String(url) === `/api/cafes/${CAFE_ID}`) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "internal_error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const handleMissingCafe = vi.fn();
    const queryClient = makeClient();

    try {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>
            <DetailContent
              cafeId={CAFE_ID}
              variant="full"
              controller={stubController(handleMissingCafe)}
              onCheckIn={vi.fn()}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      );

      // Wait until retries exhaust (failureCount reaches 2, so 3 calls total)
      await waitFor(() => {
        const calls = fetchSpy.mock.calls.filter(([url]) => String(url) === `/api/cafes/${CAFE_ID}`);
        expect(calls).toHaveLength(3);
      });
      expect(handleMissingCafe).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

