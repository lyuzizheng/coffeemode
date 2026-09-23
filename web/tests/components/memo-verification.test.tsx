// BRAWUKA-647: FeedCard/PeekCard are memo-wrapped — a parent re-render with
// unchanged props must not re-render the cards. Render counts are observed
// through the cards' own hook/child calls (useTranslations / CafeCardBody);
// the baselines assert those still fire, so a refactor that drops them fails
// loudly instead of silently passing.
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { DiscoveryController } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import type { PublicCheckIn } from "@/types/checkins";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";

// Count FeedCard subtree renders via its useTranslations calls.
const { tCalls } = vi.hoisted(() => ({ tCalls: { n: 0 } }));
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useTranslations: (...args: Parameters<typeof actual.useTranslations>) => {
      tCalls.n += 1;
      return actual.useTranslations(...args);
    },
  };
});

// Count PeekCard renders via CafeCardBody.
const { bodyCalls } = vi.hoisted(() => ({ bodyCalls: { n: 0 } }));
vi.mock("@/components/discovery/cafe-card", () => ({
  CafeCardBody: () => {
    bodyCalls.n += 1;
    return <div>cafe body</div>;
  },
}));

import { FeedCard } from "@/components/discovery/feed-card";
import { MobileSheet } from "@/components/discovery/mobile-sheet";

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const checkin: PublicCheckIn = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31",
  scores: { wifi: 80 },
  max_stay: null,
  note: "note",
  photos: [],
  likes_count: 0,
  liked_by_viewer: false,
  owned_by_viewer: false,
  visited_at: "2026-08-20T10:00:00.000Z",
  author: null,
};

const cafe: CafeSummary = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Cafe",
  lat: 1.29,
  lng: 103.85,
  address: "addr",
  city: "singapore",
  tz: "Asia/Singapore",
  opening_hours: null,
  price_range: 2,
  cover: null,
  distance_m: 100,
  maintained_by_service: false,
  work_stats: emptyWorkStats(),
};

describe("BRAWUKA-647 memo", () => {
  it("FeedCard does not re-render on parent re-render with same props", () => {
    const onLike = vi.fn();
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((v) => v + 1)}>tick {tick}</button>
          <FeedCard
            checkin={checkin}
            cafeId="c1"
            cafeName="Cafe"
            onLike={onLike}
            likePending={false}
          />
        </>
      );
    }
    const { getByText } = render(
      <Wrapper>
        <Parent />
      </Wrapper>,
    );
    const baseline = tCalls.n;
    expect(baseline).toBeGreaterThan(0);
    fireEvent.click(getByText("tick 0"));
    fireEvent.click(getByText("tick 1"));
    expect(tCalls.n).toBe(baseline);
  });

  it("PeekCard does not re-render on MobileSheet re-render with same props", () => {
    const controller: DiscoveryController = {
      selectedCafeId: null,
      snap: "peek",
      select: vi.fn(),
      snapTo: vi.fn(),
      close: vi.fn(),
      handleMissingCafe: vi.fn(),
      registerCardRef: vi.fn(),
      detailHeadingRef: vi.fn(),
    };
    const props = {
      controller,
      cafes: [cafe],
      isLoading: false,
      isError: false,
      onRetry: vi.fn(),
      onCheckIn: vi.fn(),
      addCafe: null,
      navPrompt: null,
    };
    const { rerender } = render(
      <Wrapper>
        <MobileSheet {...props} distanceM={100} />
      </Wrapper>,
    );
    const baseline = bodyCalls.n;
    expect(baseline).toBe(1);
    rerender(
      <Wrapper>
        <MobileSheet {...props} distanceM={200} />
      </Wrapper>,
    );
    rerender(
      <Wrapper>
        <MobileSheet {...props} distanceM={300} />
      </Wrapper>,
    );
    expect(bodyCalls.n).toBe(baseline);
  });
});
