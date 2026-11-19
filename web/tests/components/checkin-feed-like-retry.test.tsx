/**
 * BRAWUKA-1020 — like/unlike on a rate-limited API.
 *
 * Staging reported a like (200) followed by an unlike (429): the toggle
 * shared the per-user `cafes-write` bucket but had spent 1 of 10 tokens, and
 * the app emitted no `rate_limited` line — the 429 came from the edge, before
 * the route. A 429 is the one failure class that cannot have applied state
 * (the app's guard rejects before the handler; a pre-origin 429 never
 * arrives), so the like mutation replays it once after the **full**
 * `Retry-After` instead of dropping the user's action (spec 0011; the
 * predicate and delay live beside the mutation in `use-checkin-feed.ts`).
 *
 * These tests pin the observable behavior of that policy on the real hook:
 *   - like → unlike consecutively: counts go 1 → 0, no toast.
 *   - one transient 429 on the unlike: no replay inside the wait, a replay
 *     only after the full header delay (45 s honoured, past the 30 s query
 *     cap), the card stays disabled while it waits, then settles at 0.
 *   - a persistent 429: exactly two attempts, optimistic state rolls back to
 *     liked/1, and the localized failure toast fires.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import type { CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

const { apiFetchMock, toastMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@heroui/react", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `trans_${key}`,
}));

import type * as HttpModule from "@/lib/http";

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

import { ApiError } from "@/lib/http";
import { useCheckinFeed } from "@/components/discovery/use-checkin-feed";

const CAFE_ID = "11111111-1111-4111-8111-111111111111";
const CHECKIN_ID = "22222222-2222-4222-8222-222222222222";

type LikeResponse = { liked: boolean; likes_count: number };

let serverLiked = false;
let serverCount = 0;
let likeResponses: Array<LikeResponse | Error | Promise<LikeResponse>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function publicCheckIn(liked: boolean, count: number): PublicCheckIn {
  return {
    id: CHECKIN_ID,
    scores: { overall: 80 },
    max_stay: "3h",
    note: "staging seed",
    photos: [],
    likes_count: count,
    liked_by_viewer: liked,
    owned_by_viewer: false,
    visited_at: "2026-11-18T00:00:00.000Z",
    author: null,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
}

function seedFeed(queryClient: QueryClient, liked: boolean, count: number) {
  // Keep the mock "server" in step with the seeded cache: the onSettled
  // invalidation refetches this page, so a seeded-but-unsynced server would
  // overwrite the rollback assertion with its own stale state.
  serverLiked = liked;
  serverCount = count;
  queryClient.setQueryData<InfiniteData<CheckInFeedPage>>(
    ["cafe-checkins", CAFE_ID, "newest"],
    {
      pages: [{ checkins: [publicCheckIn(liked, count)], next_cursor: null }],
      pageParams: [undefined],
    },
  );
}

function cachedCheckin(queryClient: QueryClient): PublicCheckIn | undefined {
  return queryClient.getQueryData<InfiniteData<CheckInFeedPage>>([
    "cafe-checkins",
    CAFE_ID,
    "newest",
  ])?.pages[0]?.checkins[0];
}

function likePostCount(): number {
  return apiFetchMock.mock.calls.filter(
    ([url]) => url === `/api/checkins/${CHECKIN_ID}/like`,
  ).length;
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
  serverLiked = false;
  serverCount = 0;
  likeResponses = [];

  apiFetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith(`/api/cafes/${CAFE_ID}/checkins`)) {
      return {
        checkins: [publicCheckIn(serverLiked, serverCount)],
        next_cursor: null,
      } satisfies CheckInFeedPage;
    }
    if (url === `/api/checkins/${CHECKIN_ID}/like`) {
      const next = likeResponses.shift();
      if (next === undefined) throw new Error(`unexpected like POST: ${url}`);
      if (next instanceof Error) throw next;
      const value = await next;
      serverLiked = value.liked;
      serverCount = value.likes_count;
      return value;
    }
    throw new Error(`unexpected apiFetch: ${url}`);
  });
});

const rateLimited = (retryAfterMs = 150) =>
  new ApiError({ status: 429, code: "rate_limited", retryAfterMs });

describe("useCheckinFeed like/unlike under rate limiting", () => {
  it("toggles 0→1→0 on two consecutive like calls", async () => {
    const queryClient = makeQueryClient();
    seedFeed(queryClient, false, 0);
    likeResponses = [
      { liked: true, likes_count: 1 },
      { liked: false, likes_count: 0 },
    ];

    const { result } = renderHook(() => useCheckinFeed(CAFE_ID, "newest"), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      result.current.like(publicCheckIn(false, 0));
    });
    await waitFor(() => {
      expect(cachedCheckin(queryClient)).toMatchObject({
        liked_by_viewer: true,
        likes_count: 1,
      });
    });
    await waitFor(() => expect(result.current.likePendingIds.size).toBe(0));

    await act(async () => {
      result.current.like(publicCheckIn(true, 1));
    });
    await waitFor(() => {
      expect(cachedCheckin(queryClient)).toMatchObject({
        liked_by_viewer: false,
        likes_count: 0,
      });
    });
    await waitFor(() => expect(result.current.likePendingIds.size).toBe(0));

    expect(likePostCount()).toBe(2);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("waits out the full Retry-After and stays disabled through the replay", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = makeQueryClient();
      seedFeed(queryClient, true, 1);
      const replay = deferred<LikeResponse>();
      likeResponses = [rateLimited(45_000), replay.promise];

      const { result } = renderHook(() => useCheckinFeed(CAFE_ID, "newest"), {
        wrapper: wrapper(queryClient),
      });

      await act(async () => {
        result.current.like(publicCheckIn(true, 1));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(likePostCount()).toBe(1);
      expect(result.current.likePendingIds.has(CHECKIN_ID)).toBe(true);

      // The query policy's 30 s cap must not clip a 45 s server instruction:
      // replaying at 30 s re-enters the same exhausted `cafes-write` window
      // and burns the single attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(likePostCount()).toBe(1);
      expect(result.current.likePendingIds.has(CHECKIN_ID)).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(likePostCount()).toBe(2);
      // The replay is in flight and held: the button must stay disabled so a
      // second click cannot queue another toggle.
      expect(result.current.likePendingIds.has(CHECKIN_ID)).toBe(true);

      await act(async () => {
        replay.resolve({ liked: false, likes_count: 0 });
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.likePendingIds.size).toBe(0);
      expect(cachedCheckin(queryClient)).toMatchObject({
        liked_by_viewer: false,
        likes_count: 0,
      });
      expect(toastMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back and toasts when the 429 persists", async () => {
    const queryClient = makeQueryClient();
    seedFeed(queryClient, true, 1);

    const { result } = renderHook(() => useCheckinFeed(CAFE_ID, "newest"), {
      wrapper: wrapper(queryClient),
    });

    likeResponses = [rateLimited(), rateLimited()];
    await act(async () => {
      result.current.like(publicCheckIn(true, 1));
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith("trans_like_failed", { timeout: 4000 });
    });

    // Exactly one replay: a third request would mean the policy retried past
    // `failureCount === 0`. `onError` runs only after the retryer gives up.
    expect(likePostCount()).toBe(2);
    expect(cachedCheckin(queryClient)).toMatchObject({
      liked_by_viewer: true,
      likes_count: 1,
    });
  });
});
