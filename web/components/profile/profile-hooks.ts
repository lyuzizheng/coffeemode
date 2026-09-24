"use client";

/**
 * Profile content-area orchestration: which tab is active, the two paginated
 * queries behind the tabs, and the zero-data starter card that replaces them
 * while the account is empty (DG39). Extracted from `profile-view.tsx` so the
 * view stays under the 80-line budget.
 */
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/http";
import type { TabType } from "./profile-tabs";
import { fetchUserCheckIns } from "./profile-tab-checkins";
import { fetchUserCafes } from "./profile-tab-cafes";
import {
  dismissProfileGuide,
  hasDismissedProfileGuide,
} from "@/lib/profile-guide-store";

export function useProfileContent(isAuthenticated: boolean, mounted: boolean) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>("checkins");
  // The starter card replaces the tabs only while the account is truly
  // empty AND the user hasn't dismissed it — either condition flips it off
  // forever (DG39).
  const [guideDismissed, setGuideDismissed] = useState(
    () => hasDismissedProfileGuide(),
  );

  // The map tab is the only consumer of the cafes query: keep it disabled
  // until first visited so a plain profile load skips one paginated DB
  // query per visit (BRAWUKA-281 P2). Once fetched, the cache persists
  // across tab switches.
  const [mapTabVisited, setMapTabVisited] = useState(activeTab === "map");
  const handleTabChange = (tab: TabType) => {
    if (tab === "map") setMapTabVisited(true);
    setActiveTab(tab);
  };

  // Queries mounted unconditionally at view level to preserve prefetch &
  // cache across tab switches.
  const checkinsQuery = useInfiniteQuery({
    queryKey: ["profile", "checkins"],
    queryFn: ({ pageParam }) => fetchUserCheckIns(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated,
  });

  const cafesQuery = useInfiniteQuery({
    queryKey: ["profile", "cafes"],
    queryFn: ({ pageParam }) => fetchUserCafes(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated && mapTabVisited,
  });

  // A 400 `invalid_cursor` means the stored page param is dead — replaying
  // it (plain `refetch()`/`fetchNextPage()`) can only fail again, so drop the
  // cached pages and restart from page one (same recovery as the feed's 410
  // path, BRAWUKA-280).
  useCursorReset(queryClient, ["profile", "checkins"], checkinsQuery);
  useCursorReset(queryClient, ["profile", "cafes"], cafesQuery);

  // Zero-data guide: only once the check-ins query has answered with an
  // empty first page — a loading or failed fetch never flashes the card.
  const checkinsLoaded =
    checkinsQuery.isSuccess &&
    (checkinsQuery.data?.pages[0]?.items.length ?? 0) === 0;
  const showGuide =
    isAuthenticated && mounted && checkinsLoaded && !guideDismissed;

  const dismissGuide = () => {
    dismissProfileGuide();
    setGuideDismissed(true);
  };

  return {
    activeTab,
    handleTabChange,
    checkinsQuery,
    /**
     * Retry that never re-sends a dead cursor: clears cached pages (and
     * their page params) then refetches from page one. Plain `refetch()`
     * would replay the invalid cursor into another 400 (BRAWUKA-442).
     */
    retryCheckinsFromFirstPage: () =>
      void queryClient.resetQueries({ queryKey: ["profile", "checkins"] }),
    retryCafesFromFirstPage: () =>
      void queryClient.resetQueries({ queryKey: ["profile", "cafes"] }),
    cafesQuery,
    showGuide,
    dismissGuide,
  };
}

/**
 * Auto-recover a paginated profile query whose stored cursor went stale:
 * `invalid_cursor` can only come from a next-page fetch (page one sends no
 * cursor), so the only recovery is discarding cached pages and restarting
 * from page one (BRAWUKA-442). The `data !== undefined` guard scopes the
 * reset to that case — a page-one `invalid_cursor` is impossible, and
 * resetting there would loop forever.
 */
function useCursorReset(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  query: { error: Error | null; data: unknown },
) {
  const cursorDead =
    query.error instanceof ApiError &&
    query.error.code === "invalid_cursor" &&
    query.data !== undefined;
  useEffect(() => {
    if (!cursorDead) return;
    void queryClient.resetQueries({ queryKey });
  }, [cursorDead, queryClient, queryKey]);
}
