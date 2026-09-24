import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/http";
import { shouldRetryQuery } from "@/lib/query/retry";
import { useProfileContent } from "@/components/profile/profile-hooks";
import { fetchUserCheckIns } from "@/components/profile/profile-tab-checkins";
import { fetchUserCafes } from "@/components/profile/profile-tab-cafes";
import type { UserCheckInItemDto, UserCafeItemDto } from "@/lib/db/profile";

vi.mock("@/components/profile/profile-tab-checkins", () => ({
  fetchUserCheckIns: vi.fn(),
}));
vi.mock("@/components/profile/profile-tab-cafes", () => ({
  fetchUserCafes: vi.fn(),
}));

const fetchCheckins = vi.mocked(fetchUserCheckIns);
const fetchCafes = vi.mocked(fetchUserCafes);

const checkin: UserCheckInItemDto = {
  id: "ci-1",
  cafe_id: "cafe-1",
  cafe_name: "Cafe One",
  cafe_city: "shanghai",
  cafe_is_deleted: false,
  visited_at: "2026-09-01T08:00:00Z",
  scores: {},
  max_stay: null,
  likes_count: 0,
  notes: null,
  photos: [],
  is_creation: false,
};

const cafe: UserCafeItemDto = {
  id: "cafe-1",
  name: "Cafe One",
  city: "shanghai",
  cover: null,
  last_visited_at: "2026-09-01T08:00:00Z",
  checkins_count: 1,
  is_creation: false,
  visibility: "public",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Production policy (4xx never retries); zero delay keeps the suite fast.
        retry: (failureCount, error) => shouldRetryQuery(failureCount, error, true),
        retryDelay: () => 0,
      },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const invalidCursor = () => new ApiError({ status: 400, code: "invalid_cursor" });

describe("useProfileContent dead-cursor recovery (BRAWUKA-442)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
  });

  it("auto-resets to page one when a next-page fetch hits invalid_cursor", async () => {
    fetchCheckins
      .mockResolvedValueOnce({ items: [checkin], next_cursor: "c1" })
      .mockRejectedValueOnce(invalidCursor())
      .mockResolvedValue({ items: [checkin], next_cursor: null });

    const { result } = renderHook(() => useProfileContent(true, true), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.checkinsQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.checkinsQuery.fetchNextPage();
    });

    // The dead cursor is dropped and page one is refetched — no error loop.
    await waitFor(() => expect(result.current.checkinsQuery.isSuccess).toBe(true));
    await waitFor(() =>
      expect(result.current.checkinsQuery.data?.pages).toHaveLength(1),
    );
    const cursors = fetchCheckins.mock.calls.map((call) => call[0]);
    expect(cursors).toEqual([undefined, "c1", undefined]);
  });

  it("auto-resets the cafes query the same way once the map tab is visited", async () => {
    fetchCheckins.mockResolvedValue({ items: [checkin], next_cursor: null });
    fetchCafes
      .mockResolvedValueOnce({ items: [cafe], next_cursor: "c1" })
      .mockRejectedValueOnce(invalidCursor())
      .mockResolvedValue({ items: [cafe], next_cursor: null });

    const { result } = renderHook(() => useProfileContent(true, true), {
      wrapper: wrapper(makeClient()),
    });

    act(() => result.current.handleTabChange("map"));
    await waitFor(() => expect(result.current.cafesQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.cafesQuery.fetchNextPage();
    });

    await waitFor(() =>
      expect(result.current.cafesQuery.data?.pages).toHaveLength(1),
    );
    const cursors = fetchCafes.mock.calls.map((call) => call[0]);
    expect(cursors).toEqual([undefined, "c1", undefined]);
  });

  it("manual retry restarts from page one instead of replaying the cursor", async () => {
    fetchCheckins
      .mockResolvedValueOnce({ items: [checkin], next_cursor: "c1" })
      .mockRejectedValueOnce(new ApiError({ status: 404, code: "not_found" }))
      .mockResolvedValue({ items: [checkin], next_cursor: null });

    const { result } = renderHook(() => useProfileContent(true, true), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.checkinsQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.checkinsQuery.fetchNextPage();
    });
    await waitFor(() => expect(result.current.checkinsQuery.isError).toBe(true));

    act(() => result.current.retryCheckinsFromFirstPage());

    await waitFor(() => expect(result.current.checkinsQuery.isSuccess).toBe(true));
    const cursors = fetchCheckins.mock.calls.map((call) => call[0]);
    expect(cursors).toEqual([undefined, "c1", undefined]);
  });

  it("does not loop when page one itself returns invalid_cursor", async () => {
    fetchCheckins.mockRejectedValue(invalidCursor());

    const { result } = renderHook(() => useProfileContent(true, true), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.checkinsQuery.isError).toBe(true));
    // Give a hypothetical reset loop room to fire; the error must stay put.
    const { promise: settle, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 100);
    await settle;
    expect(result.current.checkinsQuery.isError).toBe(true);
    expect(fetchCheckins).toHaveBeenCalledTimes(1);
  });
});
